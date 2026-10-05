import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

// Blocks the agent's tool calls that would read private files while the session's model is not
// private. A blocked read never reaches the provider, so PII and secrets stay off DeepSeek, Go and
// any other provider that trains on or retains inputs. Fails closed: an unknown provider, or no
// model at all, counts as not private. A guardrail against accidents, not a wall: a shell command
// can still reach a private file indirectly (a recursive grep from $HOME, a glob, a script).
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

function real(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

// Each root under its literal path and its resolved one, so a symlink in either direction counts.
const ROOTS = [...new Set(PRIVATE_ROOTS.flatMap((p) => [p, real(p)]))];

function within(path: string, root: string): boolean {
	return path === root || path.startsWith(root + sep);
}

function absolute(path: string, cwd: string): string {
	const expanded = path === "~" ? HOME : path.startsWith("~/") ? join(HOME, path.slice(2)) : path;
	return real(isAbsolute(expanded) ? expanded : resolve(cwd, expanded));
}

// The root a path falls inside, or, for a recursive search, the root it would descend into.
function privateRootFor(path: string, recursive: boolean): string | undefined {
	return ROOTS.find((root) => within(path, root) || (recursive && within(root, path)));
}

function escape(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BEFORE = `(^|[\\s'"=:(<>|;&])`;

// A root as a shell command could spell it: absolute, ~/, $HOME/ or ${HOME}/, or relative to the
// working directory when the root sits below it. A relative spelling needs a "/" after it or a
// "./" before it, so the bare word in a commit message ("finance round") does not match.
function rootInCommand(command: string, cwd: string): string | undefined {
	return ROOTS.find((root) => {
		const full = [root];
		if (within(root, HOME)) {
			const rel = relative(HOME, root);
			full.push(`~/${rel}`, `$HOME/${rel}`, `\${HOME}/${rel}`);
		}
		if (full.some((s) => new RegExp(`${BEFORE}${escape(s)}(?=$|[/\\s'"*;&|)])`).test(command))) return true;
		if (!within(root, cwd) || root === cwd) return false;
		const rel = escape(relative(cwd, root));
		return new RegExp(`${BEFORE}${rel}/|${BEFORE}\\./${rel}(?=$|[/\\s'"*;&|)])`).test(command);
	});
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
