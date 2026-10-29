import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// pi's adapter for the ithaca store (~/.agents -> ~/projects/ithaca/store). Gives pi what CC
// loads natively: the global AGENTS.md, every rules/*.md, the output style and the memory index.
// pi's own global slot (~/.pi/agent/AGENTS.md) takes a single file, so this appends instead.
//
// The text is built once per session and reused every turn: 96% of tokens are cache reads, and
// a changed system prompt re-bills the whole context. Edits apply from the next session.
// A missing file throws — running without the rules must not pass silently.
// `ITHACA_STORE` points the adapter at another store root, the same seam context-audit.py has
// (`--store`) and the extension tests need: a store that can be edited mid-run. A stray export in a
// profile would load the wrong store silently, so store-check reports the variable when it is set,
// exactly as it does for the kill-switch.
const STORE = process.env.ITHACA_STORE?.trim() || join(homedir(), ".agents");
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
const HARNESS_FILE = join(STORE, "harnesses", `${HARNESS}.md`);

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

// What this session loaded, as a fingerprint of the files it came from: mtime *and* size per path,
// with an absent file marked so its appearance counts as a change too. The snapshot is frozen for
// the whole session (a changed prompt re-bills the context), so an edit to the store is invisible
// until the next session — and a rule that silently did not apply is the failure this store exists
// to prevent. Before every turn this is recomputed and compared: seven stats, no I/O on a model call.
function trackedPaths(): string[] {
	let rules: string[] = [];
	try {
		rules = readdirSync(RULES_DIR)
			.filter((name) => name.endsWith(".md"))
			.sort()
			.map((name) => join(RULES_DIR, name));
	} catch {
		return [];                    // a missing store throws in storeContext(); nothing to track
	}
	return [join(STORE, "AGENTS.md"), ...rules, OUTPUT_STYLE, join(MEMORY_DIR, "MEMORY.md"),
		HARNESS_FILE];
}

function storeStamp(): string {
	return trackedPaths()
		.map((path) => {
			try {
				const stat = statSync(path);
				return `${stat.mtimeMs}:${stat.size}`;
			} catch {
				return "-";
			}
		})
		.join("|");
}

function storeContext(sessionId: string): string {
	if (storeContextDisabled()) return OFF_NOTICE;
	const rules = readdirSync(RULES_DIR)
		.filter((name) => name.endsWith(".md"))
		.sort()
		.map((name) => join(RULES_DIR, name));
	const sources = [join(STORE, "AGENTS.md"), ...rules, OUTPUT_STYLE];
	if (existsSync(HARNESS_FILE)) sources.push(HARNESS_FILE);
	const files = sources.map(
		(path) => `<!-- ${path} -->\n${withoutFrontmatter(readFileSync(path, "utf8"))}`,
	);
	const index = join(MEMORY_DIR, "MEMORY.md");
	const memory = `<!-- ${index} -->\nMemory folder: ${MEMORY_DIR}/ — read a file there when its index line looks relevant.\n\n${readFileSync(index, "utf8")}`;
	const session = `pi session id: ${sessionId} — use it as the session-id in a memory's metadata.evidence line.`;
	return [...files, memory, session].join("\n\n");
}

let snapshot: string | undefined;
let loadedStamp: string | undefined;
let driftNotified = false;

const DRIFT_KEY = "ithaca-store";
const DRIFT_TEXT = "store edited — applies next session";
const DRIFT_NOTICE =
	"The ithaca store changed after this session loaded it, so the rules in effect are the ones " +
	"it loaded at start. The edit applies to the next session (the composed prompt is frozen so " +
	"the cache stays valid).";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (storeContextDisabled()) {
			ctx.ui.notify(
				"Store context is OFF (PI_STORE_CONTEXT): no rules, output style or memory index this session",
				"warning",
			);
			return;
		}
		snapshot = storeContext(ctx.sessionManager.getSessionId());
		loadedStamp = storeStamp();
	});
	pi.on("before_agent_start", async (event, ctx) => {
		if (storeContextDisabled()) {
			snapshot ??= storeContext(ctx.sessionManager.getSessionId());
			return { systemPrompt: `${event.systemPrompt}\n\n${snapshot}` };
		}
		snapshot ??= storeContext(ctx.sessionManager.getSessionId());
		loadedStamp ??= storeStamp();
		const current = storeStamp();
		if (current !== loadedStamp) {
			// Once per session: the status line carries the fact from here, and every later edit is
			// the same fact — a toast per turn would be noise around something that cannot clear
			// without a restart. The stamp still settles, so the comparison stays cheap.
			loadedStamp = current;
			if (!driftNotified) {
				driftNotified = true;
				ctx.ui.notify(DRIFT_NOTICE, "warning");
				if (ctx.hasUI) ctx.ui.setStatus(DRIFT_KEY, DRIFT_TEXT);
			}
		}
		return { systemPrompt: `${event.systemPrompt}\n\n${snapshot}` };
	});
}
