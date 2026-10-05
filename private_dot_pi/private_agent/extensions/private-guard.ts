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
		if (provider !== undefined && PRIVATE_PROVIDERS.has(provider)) return;
		const root = blockedRoot(event.toolName, event.input as Record<string, unknown>, ctx.cwd);
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
