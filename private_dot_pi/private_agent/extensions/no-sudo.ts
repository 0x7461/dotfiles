import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// no-sudo: the user runs every privilege-escalation command themselves, so the agent's bash tool may
// not run sudo/doas/pkexec/su. It blocks a command that WOULD RUN one, never a mention (`grep sudo f`,
// `echo 'run sudo x'`, `git commit -m "note about sudo"`, `cat /etc/sudoers`).
//
// A guardrail, not a wall. It cannot catch: a command word only known at runtime (`$(echo sudo) x`,
// `$VAR`), a script it only names (`bash setup.sh`), an interpreter (`python -c`), an alias, ANSI-C
// quoting ($'...'), a `<<` inside a comment or quoted string, an escaped quote inside a command
// substitution, or a launcher it does not know (systemd-run, nsenter, docker exec, stdbuf, watch,
// parallel, flock, busybox, chrt, taskset, ionice, mosh); and it ignores the powershell tool. It can
// over-block a shell function named sudo.

const ESCALATION = new Set(["sudo", "doas", "pkexec", "su"]);
const SHELLS = new Set(["sh", "bash", "dash", "zsh", "ksh", "mksh", "csh", "tcsh", "ash", "fish"]);
const KEYWORDS = new Set(["if", "then", "elif", "else", "while", "until", "do", "!"]);
const WRAPPERS = new Set(["env", "xargs", "command", "exec", "nohup", "time", "nice", "timeout"]);
// Options that take a value, so the word after them is not the launched command.
const VALUES: Record<string, string[]> = {
	env: ["-u", "--unset", "-C", "--chdir"],
	xargs: ["-a", "--arg-file", "-d", "--delimiter", "-E", "--eof", "-I", "--replace", "-L", "--max-lines", "-n", "--max-args", "-P", "--max-procs", "-s", "--max-chars"],
	nice: ["-n", "--adjustment"],
	timeout: ["-k", "--kill-after", "-s", "--signal"],
	ssh: ["-p", "-i", "-o", "-l", "-P", "-F", "-L", "-R", "-D", "-J", "-b", "-c", "-e", "-m", "-w", "-S", "-Q", "-E", "-I", "-O", "-B", "-W"],
};
const SEP = "\u0000";
const SUB = "\u0001";
function readBacktick(s: string, i: number): [string, number] {
	const j = s.indexOf("`", i + 1);
	return j < 0 ? [s.slice(i + 1), s.length] : [s.slice(i + 1, j), j + 1];
}
// Content of a $( ... ) or ( ... ) group, from the index of its "(" to the index after the match.
function readParen(s: string, open: number): [string, number] {
	let depth = 0;
	for (let i = open; i < s.length; ) {
		const c = s[i] as string;
		if (c === "\\") i += 2;
		else if (c === "'") { const e = s.indexOf("'", i + 1); i = e < 0 ? s.length : e + 1; }
		else if (c === '"') { const e = s.indexOf('"', i + 1); i = e < 0 ? s.length : e + 1; }
		else if (c === "(") { depth++; i++; }
		else if (c === ")" && --depth === 0) return [s.slice(open + 1, i), i + 1];
		else i++;
	}
	return [s.slice(open + 1), s.length];
}
// Split into words: SEP marks a command boundary, SUB+text is a command substitution to scan too.
function tokenize(s: string): string[] {
	const out: string[] = [];
	let cur = "";
	let has = false;
	let i = 0;
	const flush = () => { if (has) out.push(cur); cur = ""; has = false; };
	const sub = (inner: string) => { flush(); out.push(SUB + inner); };
	while (i < s.length) {
		const c = s[i] as string;
		if (c === "\n") { flush(); out.push(SEP); i++; }
		else if (/\s/.test(c)) { flush(); i++; }
		else if (c === "'") { has = true; const e = s.indexOf("'", i + 1); cur += e < 0 ? s.slice(i + 1) : s.slice(i + 1, e); i = e < 0 ? s.length : e + 1; }
		else if (c === '"') {
			has = true;
			for (i++; i < s.length; ) {
				const d = s[i] as string;
				if (d === "\\" && '"$`\\'.includes(s[i + 1] ?? "")) { cur += s[i + 1]; i += 2; }
				else if (d === '"') { i++; break; }
				else if (d === "$" && s[i + 1] === "(") { const [x, n] = readParen(s, i + 1); sub(x); i = n; }
				else if (d === "`") { const [x, n] = readBacktick(s, i); sub(x); i = n; }
				else { cur += d; i++; }
			}
		} else if ((c === "$" || c === "<" || c === ">") && s[i + 1] === "(") { const [x, n] = readParen(s, i + 1); sub(x); i = n; }
		else if (c === "`") { const [x, n] = readBacktick(s, i); sub(x); i = n; }
		else if (c === "\\") { has = true; if (s[i + 1] !== "\n") cur += s[i + 1] ?? "\\"; i += s[i + 1] === undefined ? 1 : 2; }
		else if (";&|".includes(c) || ("(){}".includes(c) && !has)) { flush(); out.push(SEP); i++; }
		else { has = true; cur += c; i++; }
	}
	flush();
	return out;
}
// Blank heredoc bodies so their text (often documentation about sudo) is not read as commands.
// Quote-blind: a `<<` in a comment or quoted string misfires, which can only hide a later command.
function blankHeredocs(src: string): string {
	const lines = src.split("\n");
	let pending: { word: string; tabs: boolean } | undefined;
	for (let i = 0; i < lines.length; i++) {
		if (pending) {
			if ((pending.tabs ? (lines[i] as string).replace(/^\t+/, "") : lines[i]) === pending.word) pending = undefined;
			else lines[i] = "";
			continue;
		}
		const re = /(?<!<)<<(?!<)(-?)\s*(['"]?)([A-Za-z_]\w*)\2/g;
		for (let m = re.exec(lines[i] as string); m; m = re.exec(lines[i] as string)) pending = { word: m[3] as string, tabs: m[1] === "-" };
	}
	return lines.join("\n");
}
// A redirection word's width: 2 when it swallows its target, 1 when the target is attached, else 0.
function redirSkip(v: string): number {
	const m = /^(?:[0-9]+)?(?:&>>|&>|>>|>\||<>|>&|<&|<<<|<<-|<<|<|>)(.*)$/.exec(v);
	return m === null ? 0 : m[1] === "" ? 2 : 1;
}
// Index of the command a launcher runs, past its options (and a timeout duration).
function skipWrapper(all: string[], i: number, base: string): number {
	const opts = VALUES[base] ?? [];
	let j = i + 1;
	while (j < all.length) {
		const v = all[j] as string;
		if (v === "--") return j + 1;
		if (!v.startsWith("-") || v === "-") break;
		const o = opts.find((x) => v === x || v.startsWith(`${x}=`) || (x.length === 2 && v.length > 2 && v.startsWith(x)));
		j += o !== undefined && v === o ? 2 : 1;
	}
	if (base === "timeout" && /^[0-9]/.test(all[j] ?? "")) j++;
	return j;
}
// `env -S 'cmd args'` splits a string into a command and its arguments.
function inlineScript(all: string[], i: number, base: string): string | undefined {
	if (base !== "env") return undefined;
	for (let j = i + 1; j < all.length; j++) {
		const v = all[j] as string;
		if (v === "-S" || v === "--split-string") return all[j + 1];
		if (v.startsWith("-S") && v.length > 2) return v.slice(2);
		if (v.startsWith("--split-string=")) return v.slice(14);
	}
	return undefined;
}
// The script of a shell's -c option, or undefined when no -c is present.
function shellScript(all: string[], i: number): string | undefined {
	for (let j = i + 1; j < all.length; j++) {
		const v = all[j] as string;
		if (v === "--") return undefined;
		if (v.startsWith("+") && v.length > 1) { if (v[1] === "o" || v[1] === "O") j++; continue; }
		if (v.startsWith("--") || v === "-") continue;
		if (!v.startsWith("-")) return undefined; // the first non-option word is a script file
		const c = v.indexOf("c", 1);
		if (c < 0) { if (v === "-o" || v === "-O") j++; continue; }
		const script = v.slice(c + 1) || all[j + 1];
		return script === undefined ? undefined : escalationInString(script);
	}
	return undefined;
}
function escalates(all: string[]): string | undefined {
	for (let i = 0; i < all.length; ) {
		const v = all[i] as string;
		const r = redirSkip(v);
		if (r) { i += r; continue; }
		if (/^[A-Za-z_]\w*=/.test(v)) { i++; continue; }
		const base = v.split("/").pop() || v;
		if (KEYWORDS.has(base)) { i++; continue; }
		if (ESCALATION.has(base)) return base;
		if (SHELLS.has(base)) return shellScript(all, i);
		if (base === "eval") return escalationInString(all.slice(i + 1).join(" "));
		if (base === "find") { for (let j = i + 1; j < all.length; j++) if (["-exec", "-execdir", "-ok", "-okdir"].includes(all[j] as string)) { const e = escalates(all.slice(j + 1)); if (e !== undefined) return e; } return undefined; }
		if (base === "ssh") { const j = skipWrapper(all, i, base) + 1; return j < all.length ? escalationInString(all.slice(j).join(" ")) : undefined; }
		if (WRAPPERS.has(base)) {
			const next = all[i + 1] ?? "";
			if (base === "command" && next.startsWith("-") && /[vV]/.test(next)) return undefined;
			const inline = inlineScript(all, i, base);
			if (inline !== undefined) return escalationInString(inline);
			i = skipWrapper(all, i, base);
			continue;
		}
		return undefined;
	}
	return undefined;
}
function escalationInString(src: string): string | undefined {
	const toks = tokenize(blankHeredocs(src));
	for (const t of toks) if (t[0] === SUB) { const e = escalationInString(t.slice(1)); if (e !== undefined) return e; }
	let words: string[] = [];
	for (const t of toks) {
		if (t === SEP) { const e = words.length ? escalates(words) : undefined; if (e !== undefined) return e; words = []; }
		else if (t[0] !== SUB) words.push(t);
	}
	return words.length ? escalates(words) : undefined;
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
