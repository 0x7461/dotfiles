import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Gives pi what CC loads globally: ~/.claude/CLAUDE.md, every ~/.claude/rules/*.md and the
// active output style. pi's own global slot (~/.pi/agent/AGENTS.md) takes a single file.
// Files are re-read every turn, so edits apply without /reload. A missing file throws —
// running without the rules must not pass silently.
const CLAUDE_DIR = join(homedir(), ".claude");
const RULES_DIR = join(CLAUDE_DIR, "rules");
const OUTPUT_STYLE = join(CLAUDE_DIR, "output-styles", "answer-first-concise.md");

function withoutFrontmatter(text: string): string {
	return text.replace(/^---\n[\s\S]*?\n---\n/, "");
}

function globalContext(): string {
	const rules = readdirSync(RULES_DIR)
		.filter((name) => name.endsWith(".md"))
		.sort()
		.map((name) => join(RULES_DIR, name));
	return [join(CLAUDE_DIR, "CLAUDE.md"), ...rules, OUTPUT_STYLE]
		.map((path) => `<!-- ${path} -->\n${withoutFrontmatter(readFileSync(path, "utf8"))}`)
		.join("\n\n");
}

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${globalContext()}`,
	}));
}
