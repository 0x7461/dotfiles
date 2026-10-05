import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// no-sudo: the user runs every privilege-escalation command themselves, so the agent's bash tool may
// not run sudo/doas/pkexec/su. It blocks a command that WOULD RUN one, never a mention (`grep sudo f`,
// `echo 'run sudo x'`, `git commit -m "note about sudo"`, `cat /etc/sudoers`).
//
// A guardrail, not a wall. It cannot catch: a command word only known at runtime (`$(echo sudo) x`,
// `$VAR`), a script it only names (`bash setup.sh`), an interpreter (`python -c`), an alias, ANSI-C
// quoting ($'...'), an escaped quote inside a command substitution, a `<<` inside a comment or quoted
// string, a leading redirection (`2>/dev/null sudo x`), `command` before the command, a launcher's
// long option (`timeout --signal=KILL 5 sudo x`), an assignment holding a substitution before the
// command (`x=$(date) sudo ls`), or a launcher it
// does not know (systemd-run, nsenter, docker exec, stdbuf, watch, parallel, flock, busybox, chrt,
// taskset, ionice, mosh); and it ignores the powershell tool. It can over-block a shell function
// named sudo.

const ESCALATION = new Set(["sudo", "doas", "pkexec", "su"]);
const SHELLS = new Set(["sh", "bash", "dash", "zsh", "ksh", "mksh", "csh", "tcsh", "ash", "fish"]);

// Words that stand immediately before a command. The value is the short options that take a value, so
// the word after one is skipped: launchers have some, the shell keywords have none.
const PREFIXES: Record<string, string> = {
	env: "uC",
	xargs: "aEdEILnPs",
	nice: "n",
	timeout: "ks",
	exec: "",
	nohup: "",
	time: "",
	if: "",
	then: "",
	elif: "",
	else: "",
	while: "",
	until: "",
	do: "",
	"!": "",
};

// Short options of ssh that take a value, so its host is not mistaken for an option value.
const SSH_VALUE_OPTS = "piolFRDJbcemwSQEIOBW";

// A word list is separated into commands by this token.
const SEPARATOR = "\u0000";

// The shell code inside the substitution at source[i], and the index after it.
function readSubstitution(source: string, i: number): [string, number] {
	if (source[i] === "`") {
		const end = source.indexOf("`", i + 1);
		if (end < 0) {
			return [source.slice(i + 1), source.length];
		}
		return [source.slice(i + 1, end), end + 1];
	}
	return scanParen(source, i + 1);
}

// Content of a ( ... ) group, from the index of its "(" to the index after the matching one.
function scanParen(source: string, open: number): [string, number] {
	let depth = 0;
	let i = open;
	while (i < source.length) {
		const char = source[i] as string;
		if (char === "\\") {
			i += 2;
			continue;
		}
		if (char === "'") {
			const end = source.indexOf("'", i + 1);
			i = end < 0 ? source.length : end + 1;
			continue;
		}
		if (char === '"') {
			const end = source.indexOf('"', i + 1);
			i = end < 0 ? source.length : end + 1;
			continue;
		}
		if (char === "(") {
			depth += 1;
			i += 1;
			continue;
		}
		if (char === ")") {
			depth -= 1;
			if (depth === 0) {
				return [source.slice(open + 1, i), i + 1];
			}
			i += 1;
			continue;
		}
		i += 1;
	}
	return [source.slice(open + 1), source.length];
}

// Split a shell fragment into words. SEPARATOR ends a simple command. Quoted text stays one word. A
// substitution contributes its own tokens, put behind a separator so its first word reads as a command.
function tokenize(source: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let pending = false;
	let i = 0;
	const flush = () => {
		if (pending) {
			tokens.push(current);
		}
		current = "";
		pending = false;
	};
	const add = (text: string) => {
		pending = true;
		current += text;
	};
	const addCommand = (inner: string) => {
		flush();
		tokens.push(SEPARATOR);
		for (const token of tokenize(inner)) {
			tokens.push(token);
		}
	};
	while (i < source.length) {
		const char = source[i] as string;
		if (char === "\n") {
			flush();
			tokens.push(SEPARATOR);
			i += 1;
			continue;
		}
		if (/\s/.test(char)) {
			flush();
			i += 1;
			continue;
		}
		if (char === "'") {
			pending = true;
			const end = source.indexOf("'", i + 1);
			current += end < 0 ? source.slice(i + 1) : source.slice(i + 1, end);
			i = end < 0 ? source.length : end + 1;
			continue;
		}
		if (char === '"') {
			pending = true;
			i += 1;
			while (i < source.length) {
				const inner = source[i] as string;
				if (inner === "\\" && '"$`\\'.includes(source[i + 1] ?? "")) {
					add(source[i + 1]);
					i += 2;
					continue;
				}
				if (inner === '"') {
					i += 1;
					break;
				}
				if (inner === "`" || (inner === "$" && source[i + 1] === "(")) {
					const [body, next] = readSubstitution(source, i);
					addCommand(body);
					i = next;
					continue;
				}
				add(inner);
				i += 1;
			}
			continue;
		}
		if (((char === "$" || char === "<" || char === ">") && source[i + 1] === "(") || char === "`") {
			const [body, next] = readSubstitution(source, i);
			addCommand(body);
			i = next;
			continue;
		}
		if (char === "\\") {
			if (source[i + 1] === undefined) {
				add("\\");
				i += 1;
			} else if (source[i + 1] === "\n") {
				i += 2;
			} else {
				add(source[i + 1]);
				i += 2;
			}
			continue;
		}
		if (";&|".includes(char) || ("(){}".includes(char) && !pending)) {
			flush();
			tokens.push(SEPARATOR);
			i += 1;
			continue;
		}
		add(char);
		i += 1;
	}
	flush();
	return tokens;
}

// Blank heredoc bodies so their text (often documentation about sudo) is not read as commands.
// Quote-blind: a `<<` in a comment or quoted string misfires, which can only hide a later command.
function blankHeredocs(source: string): string {
	const lines = source.split("\n");
	let pending: { word: string; tabs: boolean } | undefined;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] as string;
		if (pending !== undefined) {
			const candidate = pending.tabs ? line.replace(/^\t+/, "") : line;
			if (candidate === pending.word) {
				pending = undefined;
			} else {
				lines[i] = "";
			}
			continue;
		}
		const pattern = /(?<!<)<<(?!<)(-?)\s*(['"]?)([A-Za-z_]\w*)\2/g;
		for (let match = pattern.exec(line); match !== null; match = pattern.exec(line)) {
			pending = { word: match[3], tabs: match[1] === "-" };
		}
	}
	return lines.join("\n");
}

// Skip a launcher's option words. valueFlags lists the short options that take a value, so the word
// after one is skipped as well.
function skipOptions(words: string[], start: number, valueFlags: string): number {
	let j = start;
	while (j < words.length) {
		const word = words[j] as string;
		if (word === "--") {
			return j + 1;
		}
		if (!word.startsWith("-") || word === "-" || word.startsWith("--")) {
			break;
		}
		const takesValue = valueFlags.includes(word.charAt(1));
		j += takesValue && word.length === 2 ? 2 : 1;
	}
	return j;
}

// The script a shell's -c option would run, or undefined when the call has no -c.
function shellEscalation(words: string[], i: number): string | undefined {
	for (let j = i + 1; j < words.length; j++) {
		const word = words[j] as string;
		if (word === "--") {
			return undefined;
		}
		if (word.startsWith("--") || word === "-") {
			continue;
		}
		if (!word.startsWith("-")) {
			return undefined; // the first non-option word is a script file, not inline code
		}
		const flags = word.slice(1);
		if (flags === "o" || flags === "O") {
			j += 1; // the next word is the option's value
			continue;
		}
		const c = flags.indexOf("c");
		if (c < 0) {
			continue;
		}
		const attached = flags.slice(c + 1);
		const script = attached === "" ? words[j + 1] : attached;
		if (script === undefined) {
			return undefined;
		}
		return escalationInString(script);
	}
	return undefined;
}

// The escalation a find command would run, if any of its -exec style actions has one.
function findExecEscalation(words: string[], i: number): string | undefined {
	for (let j = i + 1; j < words.length; j++) {
		if (!["-exec", "-execdir", "-ok", "-okdir"].includes(words[j] as string)) {
			continue;
		}
		const found = escalates(words.slice(j + 1));
		if (found !== undefined) {
			return found;
		}
	}
	return undefined;
}

// `ssh [options] host command...` runs the command on the remote host.
function remoteEscalation(words: string[], i: number): string | undefined {
	let j = skipOptions(words, i + 1, SSH_VALUE_OPTS);
	if (j >= words.length) {
		return undefined;
	}
	j += 1; // the host
	if (j >= words.length) {
		return undefined;
	}
	return escalationInString(words.slice(j).join(" "));
}

// The escalation command a single simple command would run, if any.
function escalates(words: string[]): string | undefined {
	for (let i = 0; i < words.length; ) {
		const word = words[i] as string;
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
			i += 1;
			continue;
		}
		const name = word.split("/").pop() || word;
		if (ESCALATION.has(name)) {
			return name;
		}
		if (SHELLS.has(name)) {
			return shellEscalation(words, i);
		}
		if (name === "eval") {
			return escalationInString(words.slice(i + 1).join(" "));
		}
		if (name === "find") {
			return findExecEscalation(words, i);
		}
		if (name === "ssh") {
			return remoteEscalation(words, i);
		}
		if (PREFIXES[name] !== undefined) {
			let j = skipOptions(words, i + 1, PREFIXES[name]);
			if (name === "timeout" && /^[0-9]/.test(words[j] ?? "")) {
				j += 1; // the duration
			}
			i = j;
			continue;
		}
		return undefined;
	}
	return undefined;
}

function escalationInString(source: string): string | undefined {
	const tokens = tokenize(blankHeredocs(source));
	let words: string[] = [];
	for (const token of tokens) {
		if (token !== SEPARATOR) {
			words.push(token);
			continue;
		}
		if (words.length > 0) {
			const found = escalates(words);
			if (found !== undefined) {
				return found;
			}
		}
		words = [];
	}
	if (words.length > 0) {
		return escalates(words);
	}
	return undefined;
}

/** The escalation command a shell string would run, or undefined if it only mentions one. */
export function findEscalation(command: string): string | undefined {
	return escalationInString(command);
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
