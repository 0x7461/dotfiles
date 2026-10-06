import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, readdirSync } from "node:fs";
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

function storeContext(sessionId: string): string {
	const rules = readdirSync(RULES_DIR)
		.filter((name) => name.endsWith(".md"))
		.sort()
		.map((name) => join(RULES_DIR, name));
	const files = [join(STORE, "AGENTS.md"), ...rules, OUTPUT_STYLE].map(
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
		snapshot = storeContext(ctx.sessionManager.getSessionId());
	});
	pi.on("before_agent_start", async (event, ctx) => {
		snapshot ??= storeContext(ctx.sessionManager.getSessionId());
		return { systemPrompt: `${event.systemPrompt}\n\n${snapshot}` };
	});
}
