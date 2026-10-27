import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// pi's adapter for the ithaca store (~/.agents -> ~/projects/ithaca/store). Gives pi what CC
// loads natively: the global AGENTS.md, every rules/*.md, the output style and the memory index.
// pi's own global slot (~/.pi/agent/AGENTS.md) takes a single file, so this appends instead.
//
// The text is built once per session and reused every turn: 96% of tokens are cache reads, and
// a changed system prompt re-bills the whole context. Edits apply from the next session.
// A missing file throws — running without the rules must not pass silently.
const STORE = join(homedir(), ".agents");
const RULES_DIR = join(STORE, "rules");
const MEMORY_DIR = join(STORE, "memory");
const OUTPUT_STYLE = join(STORE, "styles", "answer-first-concise.md");

function withoutFrontmatter(text: string): string {
	return text.replace(/^---\n[\s\S]*?\n---\n/, "");
}

// Harness-specific rules live in ~/.agents/harnesses/<agent>.md, included only by that harness's
// deployment (2026-10-27). Nothing is tagged or filtered here any more: the shared files are neutral
// by construction, so this adapter reads them as they are and appends pi's own file.
const HARNESS = "pi";

// A kill-switch, for answering "what does the store actually inject" without editing this file.
// It must not be silent: ui.notify is a no-op under `-p`, so the prompt itself says the store is
// off. A session running without the rules is the failure the store exists to prevent, and it is
// the headless run — the one that cannot see a notification — that would hide it.
const OFF_VALUES = new Set(["0", "false", "off", "none", "disabled"]);
const OFF_NOTICE = "<!-- store context OFF: PI_STORE_CONTEXT is set to a disabling value, so " +
	"~/.agents/AGENTS.md, rules/, the output style and the memory index are NOT loaded this " +
	"session. Unset PI_STORE_CONTEXT to restore them. -->";

function storeContextDisabled(): boolean {
	const value = process.env.PI_STORE_CONTEXT?.trim().toLowerCase();
	return value !== undefined && value !== "" && OFF_VALUES.has(value);
}

function storeContext(sessionId: string): string {
	if (storeContextDisabled()) return OFF_NOTICE;
	const rules = readdirSync(RULES_DIR)
		.filter((name) => name.endsWith(".md"))
		.sort()
		.map((name) => join(RULES_DIR, name));
	const harness = join(STORE, "harnesses", `${HARNESS}.md`);
	const sources = [join(STORE, "AGENTS.md"), ...rules, OUTPUT_STYLE];
	if (existsSync(harness)) sources.push(harness);
	const files = sources.map(
		(path) => `<!-- ${path} -->\n${withoutFrontmatter(readFileSync(path, "utf8"))}`,
	);
	const index = join(MEMORY_DIR, "MEMORY.md");
	const memory = `<!-- ${index} -->\nMemory folder: ${MEMORY_DIR}/ — read a file there when its index line looks relevant.\n\n${readFileSync(index, "utf8")}`;
	const session = `pi session id: ${sessionId} — use it as the session-id in a memory's metadata.evidence line.`;
	return [...files, memory, session].join("\n\n");
}

let snapshot: string | undefined;

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (storeContextDisabled()) {
			ctx.ui.notify(
				"Store context is OFF (PI_STORE_CONTEXT): no rules, output style or memory index this session",
				"warning",
			);
		}
		snapshot = storeContext(ctx.sessionManager.getSessionId());
	});
	pi.on("before_agent_start", async (event, ctx) => {
		snapshot ??= storeContext(ctx.sessionManager.getSessionId());
		return { systemPrompt: `${event.systemPrompt}\n\n${snapshot}` };
	});
}
