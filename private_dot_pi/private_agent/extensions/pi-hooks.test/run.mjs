// Tests for the extensions that stand in for pi's hooks, since pi has no hook runner of its own:
// store-context.ts (the store prompt and its kill-switch), notify.ts (the desktop notification, its
// run-length floor and its bounds), context-nudge.ts (the pre-compaction levels pi never warns about)
// and session-name.ts (the /resume row, which shows the name instead of the first message). Exits
// non-zero on a failure.
//
//     node ~/.pi/agent/extensions/pi-hooks.test/run.mjs
//
// Everything runs through the extensions' real handlers with a fake context and a narrowed PATH, so
// no model, no desktop session and no writes outside a temp dir are involved.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
	if (ok) {
		pass++;
		console.log(`PASS  ${name}`);
	} else {
		failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
		console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
	}
}

function handlersFor(mod) {
	const map = {};
	mod.default({ on: (ev, h) => (map[ev] = h) });
	return map;
}

// ---------------------------------------------------------------- store-context.ts
const here = new URL("../", import.meta.url).pathname;
const store = await import(`${here}store-context.ts`);
const storeHandlers = handlersFor(store);
const storeCtx = () => ({
	systemPrompt: "BASE",
	sessionManager: { getSessionId: () => "test-session-id" },
	ui: { notify: (msg, level) => storeNotices.push([msg, level]) },
});
let storeNotices = [];

async function promptWith(value) {
	storeNotices = [];
	if (value === undefined) delete process.env.PI_STORE_CONTEXT;
	else process.env.PI_STORE_CONTEXT = value;
	// A fresh module instance per case: the snapshot is cached per session otherwise.
	const fresh = handlersFor(await import(`${here}store-context.ts?case=${value}`));
	await fresh.session_start({}, storeCtx());
	const out = await fresh.before_agent_start({ systemPrompt: "BASE" }, storeCtx());
	return { text: out.systemPrompt, notices: storeNotices };
}

const onByDefault = await promptWith(undefined);
check("store: loads the rules by default", onByDefault.text.includes("Behaviour rules — portable"));
check("store: no OFF notice by default", !onByDefault.text.includes("store context OFF"));
check("store: no startup notice by default", onByDefault.notices.length === 0);
check("store: keeps the pi session id line", onByDefault.text.includes("test-session-id"));

for (const value of ["0", "false", "off", "none", "disabled", "OFF", " Off "]) {
	const { text, notices } = await promptWith(value);
	check(`store: PI_STORE_CONTEXT=${JSON.stringify(value)} disables`, text.includes("store context OFF"));
	check(
		`store:    ... says so in the prompt, not only in the UI (${value})`,
		text.includes("Unset PI_STORE_CONTEXT to restore them"),
	);
	check(`store:    ... and warns at startup (${value})`, notices.length === 1 && notices[0][1] === "warning");
}

for (const value of ["1", "true", "yes", ""]) {
	const { text } = await promptWith(value);
	check(`store: PI_STORE_CONTEXT=${JSON.stringify(value)} stays enabled`, text.includes("Behaviour rules — portable"));
}

delete process.env.PI_STORE_CONTEXT;

// ---------------------------------------------------------------- notify.ts
const scratch = mkdtempSync(join(tmpdir(), "pi-hooks-test-"));
const BIN = join(scratch, "bin");
mkdirSync(BIN, { recursive: true });
const stub = (body) => {
	writeFileSync(`${BIN}/notify-send`, `#!/bin/sh\n${body}\n`);
	chmodSync(`${BIN}/notify-send`, 0o755);
};
const realPath = process.env.PATH;

const notify = await import(`${here}notify.ts?t=${Date.now()}`);
const notifyHandlers = handlersFor(notify);
let notices = [];
const notifyCtx = (hasUI = true) => ({
	hasUI,
	cwd: "/home/ta/projects/ithaca",
	ui: { notify: (msg, level) => notices.push([msg, level]) },
});

// A finished run: agent_start, then 61s later agent_settled.
async function finishedRun(ctx) {
	const realNow = Date.now;
	let t = 1_000_000;
	Date.now = () => t;
	try {
		notices = [];
		await notifyHandlers.agent_start({}, ctx);
		t += 61_000;
		await notifyHandlers.agent_settled({}, ctx);
	} finally {
		Date.now = realNow;
	}
}

// 1. notify-send missing from PATH: must warn, not emit an unhandled 'error' event.
process.env.PATH = "/nonexistent";
await finishedRun(notifyCtx());
await new Promise((r) => setTimeout(r, 300));
check(
	"notify: missing binary warns instead of crashing",
	notices.length === 1 && notices[0][0].includes("not on PATH"),
	JSON.stringify(notices),
);

// 2. A wedged notify-send is killed at the timeout.
stub("/bin/sleep 30");
process.env.PATH = BIN;
const started = Date.now();
await finishedRun(notifyCtx());
await new Promise((r) => setTimeout(r, 6_000));
const elapsed = Date.now() - started;
check("notify: a wedged binary is killed at the timeout", notices.some((n) => n[0].includes("still running after")), JSON.stringify(notices));
check("notify: the run is not held open by it", elapsed < 15_000, `${elapsed} ms`);

// 3. The happy path is silent.
stub("exit 0");
process.env.PATH = BIN;
await finishedRun(notifyCtx());
await new Promise((r) => setTimeout(r, 300));
check("notify: a working notification warns about nothing", notices.length === 0, JSON.stringify(notices));

// 4. A short run, and a headless run, do nothing at all.
stub("/bin/sleep 30");
process.env.PATH = BIN;
const realNow = Date.now;
let t = 5_000;
Date.now = () => t;
notices = [];
await notifyHandlers.agent_start({}, notifyCtx());
t += 1_000; // 1s, under the 60s floor
await notifyHandlers.agent_settled({}, notifyCtx());
Date.now = realNow;
await new Promise((r) => setTimeout(r, 6_000));
check("notify: a run under the floor stays silent", notices.length === 0, JSON.stringify(notices));

// ------------------------------------------------------- context-nudge.ts
// The store's continuation work needs the pre-compaction warning pi does not give. Percent comes
// from the model's window, so the cases below vary the window, not the token count.
const nudge = handlersFor(await import(`${here}context-nudge.ts`));
let nudgeNotices = [];
const usageCtx = (percent, hasUI = true) => ({
	hasUI,
	getContextUsage: () => ({ tokens: percent === null ? null : percent * 2000, contextWindow: 200_000, percent }),
	ui: { notify: (msg, level) => nudgeNotices.push([msg, level]) },
});

nudgeNotices = [];
for (const percent of [10, 24.9, 25.1]) await nudge.turn_end({}, usageCtx(percent));
check("nudge: fires once at 25, not below it", nudgeNotices.length === 1 && nudgeNotices[0][0].startsWith("context 25%"),
	JSON.stringify(nudgeNotices));

nudgeNotices = [];
for (const percent of [51, 60, 74]) await nudge.turn_end({}, usageCtx(percent));
check("nudge: 50 level fires once though it stays crossed", nudgeNotices.length === 1 && nudgeNotices[0][0].startsWith("context 51%"),
	JSON.stringify(nudgeNotices));

nudgeNotices = [];
await nudge.turn_end({}, usageCtx(76));
await nudge.turn_end({}, usageCtx(80));
check("nudge: 75 is a warning and fires once", nudgeNotices.length === 1 && nudgeNotices[0][1] === "warning",
	JSON.stringify(nudgeNotices));

// The null percent that immediately follows a compaction must not be read as 0% or as a fresh climb.
nudgeNotices = [];
await nudge.turn_end({}, usageCtx(null));
check("nudge: a null percent says nothing", nudgeNotices.length === 0, JSON.stringify(nudgeNotices));

// After a compaction the levels re-arm, so a long session is warned again on its second climb.
await nudge.session_compact({}, usageCtx(null));
await nudge.turn_end({}, usageCtx(26));
check("nudge: levels re-arm after a compaction", nudgeNotices.length === 1, JSON.stringify(nudgeNotices));

nudgeNotices = [];
const before = nudgeNotices.length;
await nudge.turn_end({}, usageCtx(90, false));
check("nudge: headless modes get no notification", nudgeNotices.length === before, JSON.stringify(nudgeNotices));

// -------------------------------------------------------- session-name.ts
// The picker shows the name instead of the first message, so a skill-opened session currently shows
// its whole skill body. Verify the derivation against the shapes a real session starts with.
// The journal root is read at module load, so point it at a scratch tree before importing.
process.env.ITHACA_CONTEXT_ROOT = join(scratch, "work");
const naming = await import(`${here}session-name.ts`);
check("name: strip the skill wrapper, keep the request",
	naming.deriveName('<skill name="recap" location="/home/ta/.agents/skills/recap/SKILL.md">\nlong body\n</skill>\n\ncontinue the ithaca batch') === "continue the ithaca batch");
check("name: first non-empty line only", naming.deriveName("\n\n  fix   the epoch   migration\nsecond line") === "fix the epoch migration");
check("name: no trailing punctuation", naming.deriveName("what happened to the backup?") === "what happened to the backup");
check("name: a long line is cut at a word boundary", (() => {
	const n = naming.deriveName("word ".repeat(40));
	return n.length <= 60 && n.split(" ").every((w) => w === "word");
})());
check("name: image markers do not become the name", naming.deriveName("[Image #1 800x600]\nrename the hunch output") === "rename the hunch output");
check("name: an empty prompt yields no name", naming.deriveName("   ") === "");
// A slash command whose whole message is the skill body: the row must be the skill, not its text.
check("name: a skill-only message is named after the skill",
	naming.deriveName('<skill name="recap" location="/home/ta/.agents/skills/recap/SKILL.md">\nbody\n</skill>') === "recap");
check("name: two stacked skills are both named",
	naming.deriveName('<skill name="recap">a</skill>\n<skill name="context">b</skill>') === "recap + context");

// A checkpoint objective outranks the first message: a session drifts across topics and compacts,
// so the sentence a human wrote at the checkpoint is the only summary that still fits at the end.
const workRoot = join(scratch, "work");
const projectDir = join(workRoot, "demo-project");
mkdirSync(projectDir, { recursive: true });
const journal = join(projectDir, "w-1.jsonl");
const writeJournal = (objective, rev = 1) =>
	writeFileSync(journal, `${JSON.stringify({ rev, kind: "checkpoint", payload: { objective } })}\n`);

const branch = [{ type: "message", message: { role: "user", content: '<skill name="recap">body</skill>\ncheck the switch matrix' } }];
async function namingRun({ existing, cwd = projectDir, events = ["session_start"], ownedByUs = false }) {
	let current = existing;
	const set = [];
	const appended = [];
	// A resumed session carries the ownership marker this extension appended last time; without it a
	// name looks user-set and the row stops following the checkpoint.
	const entries = ownedByUs ? [...branch, { type: "custom", customType: "ithaca-session-name", data: { name: existing } }] : branch;
	const mod = await import(`${here}session-name.ts?case=${Math.random()}`);
	const handlers = {};
	mod.default({
		on: (ev, fn) => (handlers[ev] = fn),
		getSessionName: () => current,
		setSessionName: (n) => { set.push(n); current = n; },
		appendEntry: (customType, data) => appended.push([customType, data]),
	});
	for (const ev of events) await handlers[ev]({}, { cwd, sessionManager: { getBranch: () => entries } });
	return { set, current, appended };
}

writeJournal("Batch 2 of the Sol review, closed");
let r = await namingRun({ existing: undefined });
check("name: a checkpoint objective names the session", r.current === "Batch 2 of the Sol review, closed", JSON.stringify(r.set));
check("name: the name we wrote is marked as ours in the branch", r.appended[0]?.[0] === "ithaca-session-name" && r.appended[0]?.[1]?.name === "Batch 2 of the Sol review, closed", JSON.stringify(r.appended));

// The user's own name wins, including one typed after the session was named for us.
r = await namingRun({ existing: "my own name" });
check("name: an objective never overwrites /name", r.set.length === 0, JSON.stringify(r.set));

// Later checkpoints on the same journal update the row.
r = await namingRun({ existing: undefined });
writeJournal("Deployment refactor: harness files", 2);
r = await namingRun({ existing: r.current, events: ["turn_end"], ownedByUs: true });
check("name: the newest objective updates a name this extension set", r.current === "Deployment refactor: harness files", JSON.stringify(r.set));

rmSync(projectDir, { recursive: true, force: true });
r = await namingRun({ existing: undefined, cwd: join(scratch, "no-journal-here") });
check("name: no journal falls back to the first message", r.current === "check the switch matrix", JSON.stringify(r.set));

process.env.PATH = realPath;
rmSync(scratch, { recursive: true, force: true });
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
	for (const f of failures) console.log(`  ${f}`);
	process.exit(1);
}
