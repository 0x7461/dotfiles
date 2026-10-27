import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// The /resume picker shows the session name *instead of* the first message
// (docs/session-format.md:207) — and the whole first message when no name is set, which for a
// skill-opened session is the skill's body. This names the session once, from the first prompt that
// carries real words, and then never touches it again.
//
// Two rules that look arbitrary and are not:
// - A bare handshake (`Reply ok`, the shape every probe and smoke test opens with) names *nothing*.
//   A one-turn probe then stays visibly unnamed instead of collecting a row that says "Reply ok" six
//   times over, and a multi-turn run still gets named by its first real request.
// - A message that is nothing but a skill body names the session `/skill` and stays provisional: the
//   next turn with real prose replaces it, before the row has been read. Any other name — /name,
//   --name, ctrl+r — locks the session permanently.
//
// Newlines fold into spaces before the length cut. Splitting at the first line first was a bug: a
// handoff prompt ("Continue the X1C setup. Read ~/x1c-setup-handoff.md first — <actual task>") lost
// its task to a 60-character budget, and five resumed sessions shared an identical prefix.

const MAX_NAME_CHARS = 110;

// Line-anchored so a prompt that *discusses* this markup (inside backticks) survives intact.
const BLOCK_WRAPPER = /(?:^|\n)[ \t]*<(skill|command)\b([^>]*)>[\s\S]*?<\/\1>[ \t]*(?=\n|$)/gi;
const NAME_ATTR = /\bname\s*=\s*(?:"([^"]+)"|'([^']+)')/i;
const IMAGE_MARKER = /(?:!\[[^\]]*\]\([^)]*\)|\[(?:image|file|attachment)[^\]]*\]|<image\b[^>]*>[\s\S]*?<\/image>|<image\b[^>]*\/>)/gi;
const FENCED_BLOCK = /(`{3,}|~{3,})[^\n]*\n([\s\S]*?)(?:\1|$)/g;
// A probe that appended a payload to its ping keeps the payload as the name.
const REPLY_OK_TITLE = /^reply\s+ok[.:—-]+\s*(.+)$/i;
const BARE_PING = /^reply(?:\s+with\s+exactly:?)?\s+ok(?:\s+hello)?[.!]*$/i;

export type DerivedName =
	| { kind: "final"; name: string }
	| { kind: "provisional"; name: string }
	| { kind: "ping" }
	| { kind: "empty" };

function collapse(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Cut on a word boundary, with an ellipsis when shortened, so a long prompt is visibly truncated. */
export function truncateAtWord(text: string, maxChars = MAX_NAME_CHARS): string {
	const clean = collapse(text);
	if (clean.length <= maxChars) return clean;
	const budget = maxChars - 1;
	let cut = clean.slice(0, budget);
	const space = cut.lastIndexOf(" ");
	if (space >= Math.floor(budget * 0.5)) cut = cut.slice(0, space);
	return `${cut.replace(/[,;:\s—-]+$/, "")}…`;
}

/** Classify one user prompt into a name, a provisional skill name, a ping, or nothing. */
export function deriveSessionName(rawPrompt: string): DerivedName {
	if (!rawPrompt.trim()) return { kind: "empty" };

	let wrapperName: string | null = null;
	let text = rawPrompt.replace(BLOCK_WRAPPER, (_full, _tag: string, attrs: string) => {
		const match = attrs?.match(NAME_ATTR);
		if (!wrapperName && match) wrapperName = (match[1] ?? match[2] ?? "").trim().replace(/^\/+/, "") || null;
		return "\n";
	});
	text = text.replace(IMAGE_MARKER, " ");

	// A prompt that is only a pasted block still has a name inside the block.
	let fenced: string | null = null;
	text = text.replace(FENCED_BLOCK, (_full, _fence: string, inner: string) => {
		if (!fenced && inner) fenced = inner.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? null;
		return " ";
	});

	let prose = collapse(text);
	const titled = prose.match(REPLY_OK_TITLE);
	if (titled?.[1]?.trim()) prose = titled[1].trim();

	if (prose && prose.length <= 30 && BARE_PING.test(prose)) return { kind: "ping" };
	if (prose) return { kind: "final", name: truncateAtWord(prose) };
	if (wrapperName) return { kind: "provisional", name: truncateAtWord(`/${wrapperName}`) };
	if (fenced) return { kind: "final", name: truncateAtWord(fenced) };
	return { kind: "empty" };
}

export default function (pi: ExtensionAPI) {
	let locked = false;
	let provisional: string | null = null;

	const reset = () => {
		provisional = null;
		locked = Boolean(pi.getSessionName()?.trim());
	};

	pi.on("session_start", async () => reset());

	// A name that is not the provisional one we wrote came from /name, --name, ctrl+r or a previous
	// process: lock, and never look at this session again. A cleared name unlocks.
	pi.on("session_info_changed", async (event) => {
		if (event.name === undefined) {
			locked = false;
			provisional = null;
			return;
		}
		if (event.name !== provisional) locked = true;
	});

	// `before_agent_start` carries the raw user prompt, so this runs identically in the TUI and in
	// `pi -p`, with no branch walk and no dependence on when the message is committed.
	pi.on("before_agent_start", async (event) => {
		if (locked) return;
		if (event.messageType !== "user" || typeof event.prompt !== "string") return;

		const existing = pi.getSessionName()?.trim() ?? "";
		if (existing && existing !== provisional) {
			locked = true;
			provisional = null;
			return;
		}

		const derived = deriveSessionName(event.prompt);
		if (derived.kind === "final") {
			pi.setSessionName(derived.name);
			locked = true;
			provisional = null;
		} else if (derived.kind === "provisional" && !provisional) {
			// Assign before the call: the session_info_changed it triggers must match, or it reads as
			// an external rename and locks the provisional name in forever.
			provisional = derived.name;
			pi.setSessionName(derived.name);
		}
	});
}
