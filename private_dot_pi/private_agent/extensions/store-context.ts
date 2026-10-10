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

// A line only one harness can act on is wrapped in `<!-- harness:cc -->` … `<!-- /harness -->`.
// This adapter drops every block not tagged `pi`, so a CC path, tool or flag never reaches pi's
// prompt — an instruction naming something the harness lacks invites work in the wrong place.
// CC needs no filter: it reads the file whole through its symlink, where the markers are inert.
const HARNESS = "pi";
const OPEN = /^\s*<!--\s*harness:([a-z0-9_-]+)\s*-->\s*$/;
const CLOSE = /^\s*<!--\s*\/harness\s*-->\s*$/;

function forHarness(text: string, harness = HARNESS): string {
	const kept: string[] = [];
	let skipping: string | null = null;
	for (const line of text.split("\n")) {
		const open = OPEN.exec(line);
		if (open) {
			if (skipping !== null) throw new Error(`nested harness block inside "${skipping}"`);
			skipping = open[1] ?? "";
			continue;
		}
		if (CLOSE.test(line)) {
			if (skipping === null) throw new Error("closing <!-- /harness --> with nothing open");
			skipping = null;
			continue;
		}
		if (skipping === null || skipping === harness) kept.push(line);
	}
	if (skipping !== null) throw new Error(`harness block "${skipping}" is never closed`);
	// Dropping a block can leave a run of blank lines behind.
	return kept.join("\n").replace(/\n{3,}/g, "\n\n");
}

function storeContext(sessionId: string): string {
	const rules = readdirSync(RULES_DIR)
		.filter((name) => name.endsWith(".md"))
		.sort()
		.map((name) => join(RULES_DIR, name));
	const files = [join(STORE, "AGENTS.md"), ...rules, OUTPUT_STYLE].map(
		(path) => `<!-- ${path} -->\n${forHarness(withoutFrontmatter(readFileSync(path, "utf8")))}`,
	);
	const index = join(MEMORY_DIR, "MEMORY.md");
	const memory = `<!-- ${index} -->\nMemory folder: ${MEMORY_DIR}/ — read a file there when its index line looks relevant.\n\n${forHarness(readFileSync(index, "utf8"))}`;
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
