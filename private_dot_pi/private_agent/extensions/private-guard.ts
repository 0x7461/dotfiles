import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

// Blocks the agent's tool calls that would read private files while the session's model is not
// private. A blocked read never reaches the provider, so PII and secrets stay off DeepSeek, Go and
// any other provider that trains on or retains inputs. Fails closed: an unknown provider, or no
// model at all, counts as not private. A guardrail against accidents, not a wall: a glob, a path
// built in a shell variable, or a script can still reach a private file indirectly.
const HOME = homedir();

// Providers whose requests stay on this machine.
const PRIVATE_PROVIDERS = new Set(["ollama"]);

// chezmoi.toml's [data] holds secrets, and these subcommands render them — or the target state that
// embeds them — to stdout. They are blocked on every model, ollama included: a secret never enters
// any model's context, so the private-provider exemption below does not reach them. `apply` and
// `update` render nothing by default; only their verbose form prints the changed file contents.
const SECRET_SUBCOMMANDS = new Set([
	"archive",
	"cat",
	"cat-config",
	"data",
	"diff",
	"dump",
	"dump-config",
	"execute-template",
]);
const VERBOSE_SECRET_SUBCOMMANDS = new Set(["apply", "update"]);
// Every chezmoi subcommand, so a global flag's value ("--config data") is not taken for one.
const CHEZMOI_SUBCOMMANDS = new Set([
	"add", "age", "age-keygen", "apply", "archive", "cat", "cat-config", "cd", "chattr",
	"completion", "data", "decrypt", "destroy", "diff", "docker", "doctor", "dump",
	"dump-config", "edit", "edit-config", "edit-config-template", "edit-encrypted", "encrypt",
	"execute-template", "forget", "generate", "git", "help", "ignored", "import", "init",
	"license", "manage", "managed", "merge", "merge-all", "purge", "re-add", "secret",
	"source-path", "ssh", "state", "status", "target-path", "unmanage", "unmanaged", "update",
	"verify",
]);
const WRAPPERS = new Set([
	"command", "doas", "env", "exec", "ionice", "nice", "nohup", "stdbuf", "sudo", "time", "timeout", "watch", "xargs",
]);
// Flags that take the following token as a value, so a wrapper's own arguments are not taken for
// its command ("env -u VAR chezmoi", "nice -n 5 chezmoi").
const WRAPPER_VALUE_FLAGS: Record<string, string[]> = {
	doas: ["-u", "-C"],
	env: ["-u", "--unset", "-C", "--chdir", "-S", "--split-string"],
	exec: ["-a"],
	ionice: ["-c", "-n", "-p", "-P", "-u"],
	nice: ["-n", "--adjustment"],
	stdbuf: ["-i", "-o", "-e", "--input", "--output", "--error"],
	sudo: ["-u", "--user", "-g", "--group", "-h", "--host", "-p", "--prompt", "-C", "--close-from", "-r", "--role", "-t", "--type", "-D", "--chdir"],
	time: ["-o", "--output", "-f", "--format"],
	timeout: ["-s", "--signal", "-k", "--kill-after"],
	watch: ["-n", "--interval"],
	xargs: ["-a", "--arg-file", "-d", "--delimiter", "-E", "--eof", "-I", "--replace", "-n", "--max-args", "-P", "--max-procs", "-s", "--max-chars", "-L", "--max-lines", "--process-slot-var"],
};
const SHELLS = new Set(["ash", "bash", "dash", "fish", "ksh", "sh", "zsh"]);

function tokens(segment: string): string[] {
	return (segment.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []).map((t) =>
		t.length >= 2 && (t[0] === '"' || t[0] === "'") && t.at(-1) === t[0] ? t.slice(1, -1) : t,
	);
}

function base(token: string): string {
	return token.slice(token.lastIndexOf("/") + 1);
}

// The index of the command word, stepping over a wrapper chain and the wrapper's own arguments.
// Only a token in command position counts, so "git -C ~/.local/share/chezmoi diff" is left alone
// even though an argument holds chezmoi's name.
function commandStart(toks: string[], i: number): number {
	while (i < toks.length) {
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i])) {
			i++;
			continue;
		}
		const name = base(toks[i]);
		if (!WRAPPERS.has(name)) return i;
		i++;
		const values = WRAPPER_VALUE_FLAGS[name] ?? [];
		let positional = name === "timeout" || name === "nice" ? 1 : 0;
		while (i < toks.length) {
			const t = toks[i];
			if (t === "--") {
				i++;
				break;
			}
			if (t.startsWith("-")) {
				i += values.includes(t) ? 2 : 1;
				continue;
			}
			if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) {
				i++;
				continue;
			}
			if (positional > 0 && (name !== "nice" || /^-?[0-9]+$/.test(t))) {
				positional--;
				i++;
				continue;
			}
			break;
		}
	}
	return i;
}

// The command string after a shell's -c, when the command word is a shell.
function shellCommandString(toks: string[], i: number): string | undefined {
	for (let j = i + 1; j < toks.length; j++) {
		const t = toks[j];
		if (t === "--" || !t.startsWith("-")) break;
		if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(t)) return toks[j + 1];
	}
	return undefined;
}

// The subcommand and verbose flag among a chezmoi call's arguments.
function chezmoiArgs(toks: string[], i: number): { subcommand?: string; verbose: boolean } {
	let subcommand: string | undefined;
	let verbose = false;
	for (let j = i + 1; j < toks.length; j++) {
		const t = toks[j];
		if (t === "--verbose" || t === "--verbose=true" || /^-[a-zA-Z]*v[a-zA-Z]*$/.test(t)) verbose = true;
		if (subcommand === undefined && CHEZMOI_SUBCOMMANDS.has(t)) subcommand = t;
	}
	return { subcommand, verbose };
}

// Split on shell separators that are not inside a quote, so a separator in a shell -c string stays
// with its command.
function segments(command: string): string[] {
	const out: string[] = [];
	let buf = "";
	let quote: string | undefined;
	for (const ch of command) {
		if (quote !== undefined) {
			buf += ch;
			if (ch === quote) quote = undefined;
		} else if (ch === '"' || ch === "'") {
			quote = ch;
			buf += ch;
		} else if (";|&\n()".includes(ch)) {
			out.push(buf);
			buf = "";
		} else {
			buf += ch;
		}
	}
	out.push(buf);
	return out;
}

// The text between a `(` and its matching `)`, honouring nesting, quotes and escapes. `start` is
// the index just after the opening paren.
function balanced(text: string, start: number): { text: string; end: number } | undefined {
	let depth = 1;
	let i = start;
	while (i < text.length) {
		const ch = text[i];
		if (ch === "\\") {
			i += 2;
			continue;
		}
		if (ch === "'") {
			i++;
			while (i < text.length && text[i] !== "'") i++;
			i++;
			continue;
		}
		if (ch === '"') {
			i++;
			while (i < text.length && text[i] !== '"') {
				if (text[i] === "\\") i++;
				i++;
			}
			i++;
			continue;
		}
		if (ch === "`") {
			const end = text.indexOf("`", i + 1);
			if (end === -1) return undefined;
			i = end + 1;
			continue;
		}
		if (ch === "(") depth++;
		else if (ch === ")") {
			depth--;
			if (depth === 0) return { text: text.slice(start, i), end: i + 1 };
		}
		i++;
	}
	return undefined;
}

// The inner text of each command substitution (`$(...)` or backtick). A double-quoted substitution
// still runs a command, so it is scanned; single-quoted text is literal.
function substitutions(command: string): string[] {
	const out: string[] = [];
	let i = 0;
	while (i < command.length) {
		const ch = command[i];
		if (ch === "\\") {
			i += 2;
			continue;
		}
		if (ch === "'") {
			i++;
			while (i < command.length && command[i] !== "'") i++;
			i++;
			continue;
		}
		if (ch === "$" && command[i + 1] === "(") {
			const inner = balanced(command, i + 2);
			if (inner === undefined) break;
			out.push(inner.text);
			i = inner.end;
			continue;
		}
		if (ch === "`") {
			const end = command.indexOf("`", i + 1);
			if (end === -1) break;
			out.push(command.slice(i + 1, end));
			i = end + 1;
			continue;
		}
		i++;
	}
	return out;
}

// The subcommand to name in a block, or undefined when no secret-rendering call is present.
function secretRendering(command: string): string | undefined {
	for (const segment of segments(command)) {
		const toks = tokens(segment);
		const i = commandStart(toks, 0);
		if (i >= toks.length) continue;
		const head = base(toks[i]);
		if (SHELLS.has(head)) {
			const inner = shellCommandString(toks, i);
			if (inner !== undefined) {
				const nested = secretRendering(inner);
				if (nested !== undefined) return nested;
			}
			continue;
		}
		if (head === "eval") {
			const nested = secretRendering(toks.slice(i + 1).join(" "));
			if (nested !== undefined) return nested;
			continue;
		}
		if (head !== "chezmoi") continue;
		const { subcommand, verbose } = chezmoiArgs(toks, i);
		if (subcommand === undefined) continue;
		if (SECRET_SUBCOMMANDS.has(subcommand)) return subcommand;
		if (verbose && VERBOSE_SECRET_SUBCOMMANDS.has(subcommand)) return `${subcommand} --verbose`;
	}
	for (const sub of substitutions(command)) {
		const nested = secretRendering(sub);
		if (nested !== undefined) return nested;
	}
	return undefined;
}

const PRIVATE_ROOTS = [
	".claude/pii-aliases.local.md",
	"archive",
	"mail",
	"obsidian-vault/finance",
	"obsidian-vault/journal",
	"obsidian-vault/personal",
	".config/archivist",
	".local/share/archivist",
	".ssh",
	".config/deepseek",
	".config/chezmoi/chezmoi.toml",
].map((p) => join(HOME, p));

// Resolve the deepest existing ancestor when the leaf is absent, which is normal for write, so a
// symlink into a private root still counts. realpathSync throws only when a component is missing.
function real(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return join(real(dirname(path)), basename(path));
	}
}

// Each root under its literal path and its resolved one, so a symlink in either direction counts.
const ROOTS = [...new Set(PRIVATE_ROOTS.flatMap((p) => [p, real(p)]))];

function within(path: string, root: string): boolean {
	return path === root || path.startsWith(root + sep);
}

function absolute(path: string, cwd: string): string {
	const expanded = path === "~" ? HOME : path.startsWith("~/") ? join(HOME, path.slice(2)) : path;
	return real(resolve(cwd, expanded));
}

// The root a path falls inside, or, for a recursive search, the root it would descend into.
function privateRootFor(path: string, recursive: boolean): string | undefined {
	return ROOTS.find((root) => within(path, root) || (recursive && within(root, path)));
}

function escape(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BEFORE = `(^|[\\s'"=:(<>|;&])`;
// A root may be followed by a path separator; a directory above a root only by a separator that
// ends the name, so "~/projects" is not the HOME ancestor.
const ROOT_AHEAD = `(?=$|[/\\s'"*;&|)])`;
const ANCESTOR_AHEAD = `(?=/?$|/?[\\s'"=:(<>|;&*])`;

// Every way a shell could spell a path under $HOME: literal, ~, $HOME and ${HOME}, quoted around
// the variable only.
function spellings(path: string): string[] {
	const rel = relative(HOME, path);
	if (rel === "") return [path, "~", "$HOME", "${HOME}", '"$HOME"', '"${HOME}"', "'$HOME'", "'${HOME}'"];
	return [
		path,
		`~/${rel}`,
		`$HOME/${rel}`,
		`\${HOME}/${rel}`,
		`"$HOME"/${rel}`,
		`"\${HOME}"/${rel}`,
		`'$HOME'/${rel}`,
		`'\${HOME}'/${rel}`,
	];
}

// Directories above a private root. A recursive command that names one descends into the root.
function ancestorsOf(root: string): string[] {
	const parts = relative(HOME, root).split(sep).slice(0, -1);
	const dirs = parts.map((_, i) => join(HOME, ...parts.slice(0, i + 1)));
	return dirs.flatMap(spellings).concat(spellings(HOME));
}

const ROOT_PATTERNS = ROOTS.map((root) => ({
	root,
	own: spellings(root).map((s) => new RegExp(`${BEFORE}${escape(s)}${ROOT_AHEAD}`)),
	above: ancestorsOf(root).map((s) => new RegExp(`${BEFORE}${escape(s)}${ANCESTOR_AHEAD}`)),
}));

const RECURSIVE_VERB = /(^|[\s|;&(])(rg|find|tar|rsync|du|tree)(\s|$)/;
const RECURSIVE_FLAG = /(^|[\s|;&(])(grep|cp|mv)\s+[^|;&]*(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)(\s|$)/;

function recursiveCommand(command: string): boolean {
	return RECURSIVE_VERB.test(command) || RECURSIVE_FLAG.test(command);
}

// Keep the first word of each quoted string, so a relative name still counts when it starts the
// quote ('finance/log.md') but not when it sits mid-sentence inside one ("fix mail/parser").
function quotedHeads(command: string): string {
	return command.replace(/"[^"]*"|'[^']*'/g, (q) => q[0] + q.slice(1, -1).split(/\s+/)[0] + q[0]);
}

function anyMatch(command: string, patterns: RegExp[]): boolean {
	return patterns.some((re) => re.test(command));
}

// A directory above a root, spelled relative to a working directory that contains it. Like the
// relative root form, it needs a "/" after it or a "./" before it, so a bare word does not match.
function relativeAncestor(command: string, cwd: string, root: string): boolean {
	const bare = quotedHeads(command);
	const parts = relative(HOME, root).split(sep).slice(0, -1);
	return parts.some((_, i) => {
		const dir = join(HOME, ...parts.slice(0, i + 1));
		if (!within(dir, cwd) || dir === cwd) return false;
		const rel = escape(relative(cwd, dir));
		return new RegExp(`${BEFORE}${rel}/|${BEFORE}\\./${rel}${ANCESTOR_AHEAD}`).test(bare);
	});
}

// A root as a shell command could spell it, or, for a recursive command, a directory above one.
// The relative forms keep only the first word of a quoted string, so a bare name in a message
// does not match.
function rootInCommand(command: string, cwd: string): string | undefined {
	const normalized = command.replace(/\/\.\//g, "/").replace(/\/{2,}/g, "/");
	const bare = quotedHeads(normalized);
	const recursive = recursiveCommand(normalized);
	return ROOT_PATTERNS.find(({ root, own, above }) => {
		if (anyMatch(normalized, own)) return true;
		if (recursive && anyMatch(normalized, above)) return true;
		if (recursive && relativeAncestor(normalized, cwd, root)) return true;
		if (!within(root, cwd) || root === cwd) return false;
		const rel = escape(relative(cwd, root));
		return new RegExp(`${BEFORE}${rel}/|${BEFORE}\\./${rel}${ROOT_AHEAD}`).test(bare);
	})?.root;
}

export function blockedRoot(toolName: string, input: Record<string, unknown>, cwd: string): string | undefined {
	const inside = privateRootFor(real(cwd), false);
	if (inside) return inside;
	const path = typeof input.path === "string" ? input.path : undefined;
	switch (toolName) {
		case "read":
		case "write":
		case "edit":
			return path === undefined ? undefined : privateRootFor(absolute(path, cwd), false);
		case "ls":
			return privateRootFor(absolute(path ?? ".", cwd), false);
		case "grep":
		case "find":
			return privateRootFor(absolute(path ?? ".", cwd), true);
		case "bash":
			return typeof input.command === "string" ? rootInCommand(input.command, cwd) : undefined;
		default:
			return undefined;
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		const provider = ctx.model?.provider;
		const input = event.input as Record<string, unknown>;
		// chezmoi secrets are blocked before the private-provider exemption, on every model.
		if (event.toolName === "bash" && typeof input.command === "string") {
			const sub = secretRendering(input.command);
			if (sub !== undefined) {
				return {
					block: true,
					reason:
						`private-guard: \`chezmoi ${sub}\` prints secrets from chezmoi.toml [data] to stdout, ` +
						"and a secret never enters a model's context, local models included. " +
						"Use `chezmoi-diff-redacted` instead, or ask the user to run it themselves.",
				};
			}
		}
		if (provider !== undefined && PRIVATE_PROVIDERS.has(provider)) return;
		const root = blockedRoot(event.toolName, input, ctx.cwd);
		if (root === undefined) return;
		const shown = within(root, HOME) ? `~/${relative(HOME, root)}` : root;
		return {
			block: true,
			reason:
				`private-guard: ${shown} is private and the model (${provider ?? "none"}) is not. ` +
				"Do not retry another way. Ask the user to switch to a local model or to run it themselves.",
		};
	});
}
