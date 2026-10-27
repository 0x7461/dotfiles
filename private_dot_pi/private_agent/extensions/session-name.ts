import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

// The /resume picker shows the session name *instead of* the first message
// (docs/session-format.md:207). A session opened by a skill therefore lists the whole skill body as
// its row — unreadable, and impossible to tell apart from the next skill run.
//
// The name has to survive drift: a long session spans topics and may compact several times, so the
// first message is only a floor. The real signal is the checkpoint objective — the sentence a human
// wrote when they stopped to say what the work was (ithaca's work journal). It is adopted as soon as
// one exists, and a name set with /name, --name or ctrl+r is never touched.

const NAME_MAX = 60;
const WORK_ROOT = process.env.ITHACA_CONTEXT_ROOT ?? join(homedir(), ".local", "share", "ithaca", "work");

// Skill bodies arrive as user text wrapped in a <skill …> element; the first line after it is the
// user's actual request. Also seen: <command …>, <custom-instructions>, and image markers.
const WRAPPED = /<(skill|command|custom-instructions|system)[\s\S]*?<\/\1>/g;
// A skill-only message (the whole prompt is the skill body) leaves nothing after stripping, so the
// skill's own name becomes the row: "recap", not three kilobytes of instructions.
const NAMED = /<(?:skill|command|template)\s+name="([^"]+)"/g;
const MARKER = /\[(image|file|attachment)[^\]]*\]/gi;

/** The first user text in the active branch, or "" when there is none yet. */
export function firstUserText(entries: any[]): string {
	for (const entry of entries) {
		if (entry?.type !== "message" || entry.message?.role !== "user") continue;
		const content = entry.message.content;
		const text =
			typeof content === "string"
				? content
				: Array.isArray(content)
					? content.filter((p: any) => p?.type === "text" && typeof p.text === "string").map((p: any) => p.text).join("\n")
					: "";
		if (deriveName(text)) return text;
	}
	return "";
}

/** One line, cut at a word boundary, no trailing punctuation, short enough for a picker row. */
export function shorten(text: string): string {
	const line = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
	const name = line.replace(/\s+/g, " ").replace(/[.:;,?!]+$/, "").trim();
	if (name.length <= NAME_MAX) return name;
	const cut = name.slice(0, NAME_MAX);
	const space = cut.lastIndexOf(" ");
	return (space > NAME_MAX * 0.6 ? cut.slice(0, space) : cut).trim();
}

/** One line from a user message: wrappers and image markers removed, skill name as the last resort. */
export function deriveName(text: string): string {
	const stripped = text.replace(WRAPPED, "").replace(MARKER, "");
	if (!stripped.trim()) {
		const named = [...text.matchAll(NAMED)].map((m) => m[1]);
		if (named.length) return shorten(named.join(" + "));
	}
	return shorten(stripped);
}

/**
 * The newest checkpoint objective for a project, or "" when the project has no journal yet.
 * `ithaca-context.py` names the project after the working directory's basename, so the mapping is
 * the same one the checkpoint used. A project can hold several work ids; the most recently written
 * journal is the live one.
 */
let cache: { file: string; mtime: number; value: string } | undefined;

export function latestObjective(cwd: string, root = WORK_ROOT): string {
	const dir = join(root, basename(cwd));
	let newest: { file: string; mtime: number } | undefined;
	try {
		for (const name of readdirSync(dir)) {
			if (!name.endsWith(".jsonl")) continue;
			const file = join(dir, name);
			const { mtimeMs } = statSync(file);
			if (!newest || mtimeMs > newest.mtime) newest = { file, mtime: mtimeMs };
		}
	} catch {
		return "";
	}
	if (!newest) return "";
	// Re-reading an unchanged journal every turn is pointless: the objective only moves at a
	// checkpoint, which rewrites the file.
	if (cache?.file === newest.file && cache.mtime === newest.mtime) return cache.value;
	try {
		const lines = readFileSync(newest.file, "utf8").trimEnd().split("\n");
		const last = JSON.parse(lines[lines.length - 1]);
		const objective = last?.payload?.objective;
		const value = typeof objective === "string" ? shorten(objective) : "";
		cache = { file: newest.file, mtime: newest.mtime, value };
		return value;
	} catch {
		// A half-written or foreign file must not break naming: the derived name still applies.
		return "";
	}
}

const OWN_ENTRY = "ithaca-session-name";

export default function (pi: ExtensionAPI) {
	// Names this extension wrote. Anything else in the picker came from the user and is left alone.
	// Rebuilt from the branch on every call, because ownership has to survive a /resume in a new
	// process: without it an auto-named session looks user-named and stops following its checkpoint.
	const owned = new Set<string>();

	const name = (ctx: { cwd: string; sessionManager: { getBranch(): any[] } }) => {
		const entries = ctx.sessionManager.getBranch();
		for (const entry of entries) {
			if (entry?.type === "custom" && entry.customType === OWN_ENTRY && typeof entry.data?.name === "string") owned.add(entry.data.name);
		}
		const current = pi.getSessionName();
		// /name, --name or ctrl+r: hands off for the rest of the session.
		if (current && !owned.has(current)) return;
		const apply = (next: string) => {
			pi.setSessionName(next);
			owned.add(next);
			pi.appendEntry(OWN_ENTRY, { name: next });
		};
		const objective = latestObjective(ctx.cwd);
		if (objective && objective !== current) {
			apply(objective);
			return;
		}
		// An objective outranks the derived name, so only derive while the session is still unnamed.
		if (current) return;
		const derived = deriveName(firstUserText(entries));
		if (!derived) return;
		apply(derived);
	};

	// `turn_start` and `before_agent_start` fire *before* the first user message is committed to the
	// branch — measured 2026-10-27, entries stayed at 2 through turn_start — so a fresh session has
	// nothing to derive from there. `context` has the message; `session_start` covers a resumed one
	// (its first message predates the process); `turn_end` picks up a checkpoint written this turn.
	for (const event of ["session_start", "context", "turn_end"] as const) {
		pi.on(event, async (_event: any, ctx: any) => name(ctx));
	}
}
