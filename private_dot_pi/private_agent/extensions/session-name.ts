import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// The /resume picker shows the session name *instead of* the first message
// (docs/session-format.md:207). A session opened by a skill therefore lists the whole skill body as
// its row — unreadable, and impossible to tell apart from the next skill run. A name set with
// /name or --name wins: this only fills the gap.

const NAME_MAX = 60;
// Skill bodies arrive as user text wrapped in a <skill …> element; the first line after it is the
// user's actual request. Also seen: <command …>, <custom-instructions>, and image markers.
const WRAPPED = /<(skill|command|custom-instructions|system)[\s\S]*?<\/\1>/g;
// A skill-only message (the whole prompt is the skill body) leaves nothing after stripping, so the
// skill's own name becomes the row: "recap", not three kilobytes of instructions.
const NAMED = /<(?:skill|command|template)\s+name="([^"]+)"/g;
const MARKER = /\[(image|file|attachment)[^\]]*\]/gi;

/** The first user text in the active branch, with wrappers and machine markers removed. */
function firstUserText(entries: any[]): string {
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

/** One line, no wrappers, no trailing punctuation, short enough for a picker row. */
export function deriveName(text: string): string {
	const stripped = text.replace(WRAPPED, "").replace(MARKER, "");
	const firstLine = stripped.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
	if (!firstLine) {
		const named = [...text.matchAll(NAMED)].map((m) => m[1]);
		if (named.length) return named.join(" + ").slice(0, NAME_MAX);
	}
	const name = firstLine.replace(/\s+/g, " ").replace(/[.:;,?!]+$/, "").trim();
	if (name.length <= NAME_MAX) return name;
	// Cut at a word boundary so the row does not end mid-word.
	const cut = name.slice(0, NAME_MAX);
	const space = cut.lastIndexOf(" ");
	return (space > NAME_MAX * 0.6 ? cut.slice(0, space) : cut).trim();
}

export default function (pi: ExtensionAPI) {
	// `turn_start` and `before_agent_start` both fire *before* the first user message is committed
	// to the branch — measured 2026-10-27, entries stayed at 2 through turn_start and only grew
	// afterwards — so a resume-time lookup lands too early and names nothing. `context` is assembled
	// per model call, with the message already there; `session_start` covers a resumed session, whose
	// first message predates the process. `done` stops the branch walk repeating for the session.
	let done = false;
	const once = (ctx: { sessionManager: { getBranch(): any[] } }) => {
		if (done) return;
		if (pi.getSessionName()) {
			done = true;
			return;
		}
		const name = deriveName(firstUserText(ctx.sessionManager.getBranch()));
		if (!name) return;
		pi.setSessionName(name);
		done = true;
	};

	pi.on("session_start", async (_event, ctx) => once(ctx));
	pi.on("context", async (_event, ctx) => once(ctx));
}
