import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// no-sudo: the user runs every privilege-escalation command themselves, so the agent's bash tool
// may not run sudo/doas/pkexec/su. This blocks a bash call only when the command WOULD RUN one, not
// when the word is merely mentioned: `grep sudo f`, `echo 'run sudo xbps-install -S foo'`,
// `git commit -m "note about sudo"` and `cat /etc/sudoers` all pass.
//
// How it matches: the command is tokenized with shell quoting (text inside quotes is one word),
// split into simple commands on ; && || | & newline and ( ), and each command's leading word is
// inspected. An escalation command counts only in command position — at the start of a command,
// after a wrapper that launches its argument (env, xargs, command, exec, nohup, time, nice,
// timeout, ...), inside a shell's -c string, after eval/parallel/find -exec/-ok/ssh, or after a
// keyword prefix (if, while, !). Command substitutions ($(...), `...`, <(...)) are scanned wherever
// they appear, because they execute regardless of position. Heredoc bodies are blanked first.
// Provider and model are irrelevant: this is about who runs sudo, not where the request came from.
//
// A guardrail, not a wall. It cannot catch: a command word only known at runtime (`$(echo sudo) x`,
// `$VAR`), a script it only names (`bash setup.sh`), an interpreter (`python -c`), an alias, or a
// launcher it does not know (systemd-run, nsenter, docker exec); and it ignores the powershell tool.
// It can over-block: a heredoc whose end marker it cannot find, and a shell function named sudo.

const ESCALATION = new Set(["sudo", "doas", "pkexec", "su"]);
const SHELLS = new Set(["sh", "bash", "dash", "zsh", "ksh", "mksh", "csh", "tcsh", "ash", "fish"]);
const KEYWORDS = new Set(["if", "then", "elif", "else", "while", "until", "do", "!"]);
const WRAPPERS = new Set([
	"env",
	"xargs",
	"command",
	"exec",
	"nohup",
	"time",
	"nice",
	"ionice",
	"setsid",
	"stdbuf",
	"timeout",
	"flock",
	"chrt",
	"taskset",
	"watch",
	"parallel",
	"busybox",
]);
const SSH = new Set(["ssh", "mosh"]);

// Options that take a value, so the word after them is not the launched command.
const WRAPPER_VALUE_OPTS: Record<string, string[]> = {
	env: ["-u", "--unset", "-C", "--chdir"],
	xargs: ["-a", "--arg-file", "-d", "--delimiter", "-E", "--eof", "-I", "--replace", "-L", "--max-lines", "-n", "--max-args", "-P", "--max-procs", "-s", "--max-chars"],
	nice: ["-n", "--adjustment"],
	ionice: ["-c", "--class", "-n", "--classdata", "-p", "--pid", "-P", "--pgid", "-u", "--uid"],
	timeout: ["-k", "--kill-after", "-s", "--signal"],
	watch: ["-n", "--interval"],
	stdbuf: ["-i", "-o", "-e"],
	flock: ["-w", "--wait", "-E", "--conflict-exit-code"],
	chrt: ["-p"],
	taskset: ["-p", "--pid", "-c", "--cpu-list"],
};
const SSH_VALUE_OPTS = ["-p", "-i", "-o", "-l", "-P", "-F", "-L", "-R", "-D", "-J", "-b", "-c", "-e", "-m", "-w", "-S", "-Q", "-E", "-I", "-O", "-B", "-W"];

type Word = { kind: "word"; value: string; quoted: boolean };
type Op = { kind: "op"; value: string };
type Sub = { kind: "sub"; value: string };
type Token = Word | Op | Sub;

function unescapeAnsi(ch: string): string {
	switch (ch) {
		case "n":
			return "\n";
		case "t":
			return "\t";
		case "r":
			return "\r";
		default:
			return ch;
	}
}

// Content of a $( ... ) or ( ... ) group, from the index of its "(" to the index after the match.
function readParen(s: string, open: number): [string, number] {
	let depth = 0;
	let i = open;
	while (i < s.length) {
		const c = s[i] as string;
		if (c === "\\") {
			i += 2;
			continue;
		}
		if (c === "'") {
			const e = s.indexOf("'", i + 1);
			i = e === -1 ? s.length : e + 1;
			continue;
		}
		if (c === '"') {
			i = skipDouble(s, i);
			continue;
		}
		if (c === "`") {
			const [, n] = readBacktick(s, i);
			i = n;
			continue;
		}
		if (c === "(") {
			depth++;
			i++;
			continue;
		}
		if (c === ")") {
			depth--;
			if (depth === 0) return [s.slice(open + 1, i), i + 1];
			i++;
			continue;
		}
		i++;
	}
	return [s.slice(open + 1), s.length];
}

function readBacktick(s: string, i: number): [string, number] {
	let j = i + 1;
	while (j < s.length) {
		const c = s[j] as string;
		if (c === "\\") {
			j += 2;
			continue;
		}
		if (c === "`") return [s.slice(i + 1, j), j + 1];
		j++;
	}
	return [s.slice(i + 1), s.length];
}

function skipDouble(s: string, i: number): number {
	i++;
	while (i < s.length) {
		const c = s[i] as string;
		if (c === "\\") {
			i += 2;
			continue;
		}
		if (c === '"') return i + 1;
		if (c === "$" && s[i + 1] === "(") {
			const [, n] = readParen(s, i + 1);
			i = n;
			continue;
		}
		if (c === "`") {
			const [, n] = readBacktick(s, i);
			i = n;
			continue;
		}
		i++;
	}
	return s.length;
}

function isBraceOperator(input: string, i: number): boolean {
	const prev = i === 0 ? "" : (input[i - 1] as string);
	const next = input[i + 1] ?? "";
	return (prev === "" || " \t\r\n;&|(".includes(prev)) && (next === "" || " \t\r\n;&|)".includes(next));
}

function tokenize(input: string): Token[] {
	const tokens: Token[] = [];
	const n = input.length;
	let cur = "";
	let curQuoted = false;
	let started = false;

	const flush = () => {
		if (started) tokens.push({ kind: "word", value: cur, quoted: curQuoted });
		cur = "";
		curQuoted = false;
		started = false;
	};
	const start = () => {
		started = true;
	};

	let i = 0;
	while (i < n) {
		const ch = input[i] as string;

		if (ch === " " || ch === "\t" || ch === "\r") {
			flush();
			i++;
			continue;
		}
		if (ch === "\n") {
			flush();
			tokens.push({ kind: "op", value: "\n" });
			i++;
			continue;
		}

		if (ch === "'") {
			start();
			curQuoted = true;
			const end = input.indexOf("'", i + 1);
			cur += end === -1 ? input.slice(i + 1) : input.slice(i + 1, end);
			i = end === -1 ? n : end + 1;
			continue;
		}

		if (ch === '"') {
			start();
			curQuoted = true;
			i++;
			while (i < n) {
				const c = input[i] as string;
				if (c === "\\") {
					const nx = input[i + 1];
					if (nx === '"' || nx === "\\" || nx === "$" || nx === "`") {
						start();
						curQuoted = true;
						cur += nx;
						i += 2;
						continue;
					}
					start();
					curQuoted = true;
					cur += c;
					i++;
					continue;
				}
				if (c === '"') {
					i++;
					break;
				}
				if (c === "$" && input[i + 1] === "(") {
					flush();
					const [inner, next] = readParen(input, i + 1);
					tokens.push({ kind: "sub", value: inner });
					i = next;
					continue;
				}
				if (c === "`") {
					flush();
					const [inner, next] = readBacktick(input, i);
					tokens.push({ kind: "sub", value: inner });
					i = next;
					continue;
				}
				start();
				curQuoted = true;
				cur += c;
				i++;
			}
			continue;
		}

		if (ch === "$" && input[i + 1] === "'") {
			start();
			curQuoted = true;
			i += 2;
			while (i < n) {
				const c = input[i] as string;
				if (c === "\\") {
					const nx = input[i + 1];
					start();
					curQuoted = true;
					if (nx === undefined) {
						cur += "\\";
						i++;
					} else {
						cur += unescapeAnsi(nx);
						i += 2;
					}
					continue;
				}
				if (c === "'") {
					i++;
					break;
				}
				start();
				curQuoted = true;
				cur += c;
				i++;
			}
			continue;
		}

		if (ch === "$" && input[i + 1] === "(") {
			flush();
			const [inner, next] = readParen(input, i + 1);
			tokens.push({ kind: "sub", value: inner });
			i = next;
			continue;
		}

		if (ch === "`") {
			flush();
			const [inner, next] = readBacktick(input, i);
			tokens.push({ kind: "sub", value: inner });
			i = next;
			continue;
		}

		if ((ch === "<" || ch === ">") && input[i + 1] === "(") {
			flush();
			const [inner, next] = readParen(input, i + 1);
			tokens.push({ kind: "sub", value: inner });
			i = next;
			continue;
		}

		if (ch === "\\") {
			start();
			const nx = input[i + 1];
			if (nx === undefined) {
				cur += "\\";
				i++;
			} else {
				if (nx !== "\n") cur += nx;
				i += 2;
			}
			continue;
		}

		// ( and ) are special only at a word boundary; mid-word they are literal.
		if ((ch === "(" || ch === ")") && !started) {
			flush();
			tokens.push({ kind: "op", value: ch });
			i++;
			continue;
		}

		if (ch === ";") {
			flush();
			if (input[i + 1] === ";") {
				tokens.push({ kind: "op", value: ";;" });
				i += 2;
			} else if (input[i + 1] === "&") {
				tokens.push({ kind: "op", value: ";&" });
				i += 2;
			} else {
				tokens.push({ kind: "op", value: ";" });
				i++;
			}
			continue;
		}
		if (ch === "&") {
			flush();
			if (input[i + 1] === "&") {
				tokens.push({ kind: "op", value: "&&" });
				i += 2;
			} else {
				tokens.push({ kind: "op", value: "&" });
				i++;
			}
			continue;
		}
		if (ch === "|") {
			flush();
			if (input[i + 1] === "|") {
				tokens.push({ kind: "op", value: "||" });
				i += 2;
			} else if (input[i + 1] === "&") {
				tokens.push({ kind: "op", value: "|&" });
				i += 2;
			} else {
				tokens.push({ kind: "op", value: "|" });
				i++;
			}
			continue;
		}

		if ((ch === "{" || ch === "}") && isBraceOperator(input, i)) {
			flush();
			tokens.push({ kind: "op", value: ch });
			i++;
			continue;
		}

		start();
		cur += ch;
		i++;
	}
	flush();
	return tokens;
}

type HeredocDelim = { word: string; stripTabs: boolean };

function findHeredocDelims(line: string): HeredocDelim[] {
	const delims: HeredocDelim[] = [];
	let i = 0;
	while (i < line.length) {
		const c = line[i] as string;
		if (c === "\\") {
			i += 2;
			continue;
		}
		if (c === "'") {
			const e = line.indexOf("'", i + 1);
			i = e === -1 ? line.length : e + 1;
			continue;
		}
		if (c === '"') {
			i = skipDouble(line, i);
			continue;
		}
		if (c === "#" && (i === 0 || " \t;&|(".includes(line[i - 1] as string))) break;
		if (c === "<" && line[i + 1] === "<" && line[i + 2] !== "<") {
			let j = i + 2;
			let stripTabs = false;
			if (line[j] === "-") {
				stripTabs = true;
				j++;
			}
			while (j < line.length && (line[j] === " " || line[j] === "\t")) j++;
			let word = "";
			while (j < line.length && !/\s/.test(line[j] as string)) {
				const wch = line[j] as string;
				if (wch === "'") {
					const e = line.indexOf("'", j + 1);
					word += e === -1 ? line.slice(j + 1) : line.slice(j + 1, e);
					j = e === -1 ? line.length : e + 1;
					continue;
				}
				if (wch === '"') {
					const e = line.indexOf('"', j + 1);
					word += e === -1 ? line.slice(j + 1) : line.slice(j + 1, e);
					j = e === -1 ? line.length : e + 1;
					continue;
				}
				if (wch === "\\") {
					word += line[j + 1] ?? "";
					j += 2;
					continue;
				}
				word += wch;
				j++;
			}
			if (word) delims.push({ word, stripTabs });
			i = j;
			continue;
		}
		i++;
	}
	return delims;
}

// Replace heredoc bodies with empty lines so their text (often documentation about sudo) is not
// read as commands. Lines are preserved so line numbers stay aligned.
function blankHeredocs(input: string): string {
	const lines = input.split("\n");
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i] as string;
		out.push(line);
		const delims = findHeredocDelims(line);
		i++;
		for (const d of delims) {
			let found = false;
			while (i < lines.length) {
				const cand = d.stripTabs ? (lines[i] as string).replace(/^\t+/, "") : (lines[i] as string);
				if (cand === d.word) {
					found = true;
					out.push(lines[i] as string);
					i++;
					break;
				}
				out.push("");
				i++;
			}
			if (!found) break;
		}
	}
	return out.join("\n");
}

function basename(v: string): string {
	const parts = v.split("/");
	return parts[parts.length - 1] || v;
}

const REDIR_RE = /^(?:[0-9]+)?(?:&>>|&>|>>|>\||<>|>&|<&|<<<|<<-|<<|<|>)/;

function isRedirection(v: string): boolean {
	return REDIR_RE.test(v);
}

function redirectionConsumesNext(v: string): boolean {
	const m = /^(?:[0-9]+)?(?:&>>|&>|>>|>\||<>|>&|<&|<<<|<<-|<<|<|>)(.*)$/.exec(v);
	return m !== null && m[1] === "";
}

// An option that takes a value: match its bare form, `--name=value`, or `-nVALUE`.
function optionMatches(v: string, o: string): "bare" | "attached" | undefined {
	if (v === o) return "bare";
	if (v.startsWith(`${o}=`)) return "attached";
	if (o.length === 2 && v.length > 2 && v.startsWith(o)) return "attached";
	return undefined;
}

function skipOptions(words: Word[], start: number, valueOpts: string[]): number {
	let j = start;
	while (j < words.length) {
		const v = (words[j] as Word).value;
		if (v === "--") return j + 1;
		if (!v.startsWith("-") || v === "-") break;
		const matched = valueOpts.find((o) => optionMatches(v, o) !== undefined);
		j += matched !== undefined && optionMatches(v, matched) === "bare" ? 2 : 1;
	}
	return j;
}

function skipWrapper(words: Word[], i: number, base: string): number {
	const j = skipOptions(words, i + 1, WRAPPER_VALUE_OPTS[base] ?? []);
	if (base === "timeout" && j < words.length && /^[0-9]/.test((words[j] as Word).value)) return j + 1;
	if (base === "chrt" && j < words.length && /^-?\d+$/.test((words[j] as Word).value)) return j + 1; // priority
	if (base === "taskset" && j < words.length && /^(0x[0-9a-fA-F]+|\d+)$/.test((words[j] as Word).value)) return j + 1; // cpu mask
	if (base === "flock" && j < words.length) return j + 1; // the lockfile or fd
	return j;
}

function optionValue(words: Word[], i: number, names: string[]): string | undefined {
	for (let j = i + 1; j < words.length; j++) {
		const v = (words[j] as Word).value;
		if (v === "--") break;
		for (const name of names) {
			if (v === name) return (words[j + 1] as Word | undefined)?.value;
			if (v.startsWith(`${name}=`)) return v.slice(name.length + 1);
			if (name.length === 2 && v.length > 2 && v.startsWith(name)) return v.slice(2);
		}
	}
	return undefined;
}

function wrapperInlineScript(words: Word[], i: number, base: string): string | undefined {
	if (base === "env") return optionValue(words, i, ["-S", "--split-string"]);
	if (base === "flock") return optionValue(words, i, ["-c", "--command"]);
	if (base === "parallel" || base === "watch") {
		const rest = words.slice(skipWrapper(words, i, base)).map((w) => w.value).join(" ");
		return rest === "" ? undefined : rest;
	}
	return undefined;
}

// `command -v`/`-V` prints the path instead of running the argument.
function optionPrintsOnly(words: Word[], i: number): boolean {
	for (let j = i + 1; j < words.length; j++) {
		const v = (words[j] as Word).value;
		if (v === "--") return false;
		if (v.startsWith("-") && v.length > 1) {
			if (/[vV]/.test(v.slice(1))) return true;
			continue;
		}
		return false;
	}
	return false;
}

function shellEscalates(words: Word[], i: number): string | undefined {
	for (let j = i + 1; j < words.length; j++) {
		const v = (words[j] as Word).value;
		if (v === "--") return undefined;
		if (v.startsWith("+") && v.length > 1) {
			if (v.slice(1) === "o" || v.slice(1) === "O") j++;
			continue;
		}
		if (v.startsWith("--") || v === "-") continue;
		if (v.startsWith("-")) {
			const flags = v.slice(1);
			if (flags === "o" || flags === "O") {
				j++;
				continue;
			}
			const c = flags.indexOf("c");
			if (c === -1) continue;
			const attached = flags.slice(c + 1);
			const script = attached !== "" ? attached : (words[j + 1] as Word | undefined)?.value;
			return script === undefined ? undefined : escalationInString(script);
		}
		return undefined; // first non-option word is a script file, not inline code
	}
	return undefined;
}

function findExecEscalates(words: Word[], i: number): string | undefined {
	for (let j = i + 1; j < words.length; j++) {
		const v = (words[j] as Word).value;
		if (v === "-exec" || v === "-execdir" || v === "-ok" || v === "-okdir") {
			const e = escalates(words.slice(j + 1));
			if (e !== undefined) return e;
		}
	}
	return undefined;
}

function remoteEscalates(words: Word[], i: number): string | undefined {
	let j = skipOptions(words, i + 1, SSH_VALUE_OPTS);
	if (j >= words.length) return undefined;
	j++; // host
	if (j >= words.length) return undefined;
	return escalationInString(words.slice(j).map((w) => w.value).join(" "));
}

function escalates(words: Word[]): string | undefined {
	let i = 0;
	while (i < words.length) {
		const v = (words[i] as Word).value;
		if (isRedirection(v)) {
			i += redirectionConsumesNext(v) ? 2 : 1;
			continue;
		}
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(v)) {
			i++;
			continue;
		}
		const base = basename(v);
		if (KEYWORDS.has(base)) {
			i++;
			continue;
		}
		if (ESCALATION.has(base)) return base;
		if (SHELLS.has(base)) return shellEscalates(words, i);
		if (base === "eval") return escalationInString(words.slice(i + 1).map((w) => w.value).join(" "));
		if (base === "find") return findExecEscalates(words, i);
		if (SSH.has(base)) return remoteEscalates(words, i);
		if (WRAPPERS.has(base)) {
			if (base === "command" && optionPrintsOnly(words, i)) return undefined;
			const inline = wrapperInlineScript(words, i, base);
			if (inline !== undefined) return escalationInString(inline);
			i = skipWrapper(words, i, base);
			continue;
		}
		return undefined;
	}
	return undefined;
}

function escalationInString(source: string): string | undefined {
	const tokens = tokenize(blankHeredocs(source));
	for (const t of tokens) {
		if (t.kind === "sub") {
			const e = escalationInString(t.value);
			if (e !== undefined) return e;
		}
	}
	let words: Word[] = [];
	for (const t of tokens) {
		if (t.kind === "word") {
			words.push(t);
			continue;
		}
		if (t.kind === "op" && words.length > 0) {
			const e = escalates(words);
			if (e !== undefined) return e;
			words = [];
		}
	}
	if (words.length > 0) return escalates(words);
	return undefined;
}

/** The escalation command a shell string would run, or undefined if it only mentions one. */
export function findEscalation(command: string): string | undefined {
	return escalationInString(blankHeredocs(command));
}

function blockReason(rawCommand: string): string {
	return [
		"no-sudo: this command would run a privilege-escalation command (sudo, doas, pkexec or su),",
		"and the user runs all privilege-escalation commands themselves.",
		"Do not retry this another way — not through another tool, wrapper, shell string, or spelling.",
		"Give the user this exact command to run in their own shell, with its output teed to a file under /tmp/pi/:",
		"",
		`    ${rawCommand} &| tee /tmp/pi/sudo-run.log`,
		"",
		"(their shell is fish; in bash the tee is `2>&1 | tee /tmp/pi/sudo-run.log`). Then read that file for the output.",
	].join("\n");
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return;
		const command = (event.input as { command?: unknown }).command;
		if (typeof command !== "string") return;
		if (findEscalation(command) === undefined) return;
		return { block: true, reason: blockReason(command) };
	});
}
