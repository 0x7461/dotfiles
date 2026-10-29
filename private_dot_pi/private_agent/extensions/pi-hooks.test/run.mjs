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


// ---------------------------------------------------------------- store-context.ts, drift
// The composed prompt is frozen for the session, so an edit to the store is invisible until the next
// one — and a rule that silently did not apply is the failure this store exists to prevent. A temp
// store root is the only way to edit one mid-session, which is what ITHACA_STORE is for.
const driftStore = mkdtempSync(join(tmpdir(), "pi-store-drift-"));
mkdirSync(join(driftStore, "rules"), { recursive: true });
mkdirSync(join(driftStore, "styles"), { recursive: true });
mkdirSync(join(driftStore, "memory"), { recursive: true });
mkdirSync(join(driftStore, "harnesses"), { recursive: true });
writeFileSync(join(driftStore, "AGENTS.md"), "# Store\n\nGlobal rules.\n");
writeFileSync(join(driftStore, "rules", "behaviour.md"), "# Behaviour\n\nDo the thing.\n");
writeFileSync(join(driftStore, "styles", "answer-first-concise.md"), "# Style\n");
writeFileSync(join(driftStore, "memory", "MEMORY.md"), "# Memory\n");
process.env.ITHACA_STORE = driftStore;

const drift = await import(`${here}store-context.ts?drift`);
const driftHandlers = handlersFor(drift);
const statusCalls = [];
const driftCtx = (notices) => ({
	hasUI: true,
	sessionManager: { getSessionId: () => "drift-session" },
	ui: {
		notify: (msg, level) => notices.push([msg, level]),
		setStatus: (key, text) => statusCalls.push([key, text]),
	},
});

let driftNotices = [];
await driftHandlers.session_start({}, driftCtx(driftNotices));
const first = await driftHandlers.before_agent_start({ systemPrompt: "BASE" }, driftCtx(driftNotices));
check("drift: composes from ITHACA_STORE", first.systemPrompt.includes("Do the thing."));
check("drift: no notice on an untouched store", driftNotices.length === 0 && statusCalls.length === 0);

// A real edit: the stamp carries size as well as mtime, because two writes inside one tick can share
// an mtime on a coarse filesystem.
writeFileSync(join(driftStore, "rules", "behaviour.md"), "# Behaviour\n\nDo the thing, twice.\n");
driftNotices = [];
const second = await driftHandlers.before_agent_start({ systemPrompt: "BASE" }, driftCtx(driftNotices));
check("drift: one warning after an edit", driftNotices.length === 1 && driftNotices[0][1] === "warning");
check("drift:   ... names the delay", driftNotices[0][0].includes("applies to the next session"));
check("drift:   ... and sets a persistent status", statusCalls.length === 1 && statusCalls[0][0] === "ithaca-store");
check(
	"drift: the frozen prompt keeps the OLD text (which is why the warning exists)",
	!second.systemPrompt.includes("twice."),
);

// The status carries it from here, so later turns must not toast again.
writeFileSync(join(driftStore, "AGENTS.md"), "# Store\n\nGlobal rules, revised.\n");
driftNotices = [];
await driftHandlers.before_agent_start({ systemPrompt: "BASE" }, driftCtx(driftNotices));
check("drift: a later edit does not toast again", driftNotices.length === 0 && statusCalls.length === 1);

// A harness file appearing is a change too, and it is a change from the first turn of a session —
// so it needs its own instance: the one above has already had its single warning.
const freshNotices = [];
const fresh = handlersFor(await import(`${here}store-context.ts?drift-new-file`));
await fresh.session_start({}, driftCtx(freshNotices));
check("drift: the first session has no harness file", freshNotices.length === 0);
writeFileSync(join(driftStore, "harnesses", "pi.md"), "# pi\n\nOne quirk.\n");
await fresh.before_agent_start({ systemPrompt: "BASE" }, driftCtx(freshNotices));
check("drift: an appearing harness file counts as an edit", freshNotices.length === 1);

delete process.env.ITHACA_STORE;
rmSync(driftStore, { recursive: true, force: true });

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
// Named once, from the first prompt that carries real words. Three behaviours are load-bearing and
// each has a row below: a handshake names nothing (so probes stay unnamed and multi-turn runs are
// named by their real request), a skill-only prompt is provisional (so /recap can still be replaced),
// and any name the extension did not write locks the session (so /name and ctrl+r win forever).
const naming = await import(`${here}session-name.ts`);

/** A fake pi whose setSessionName emits the session_info_changed pi would emit. */
function namingHarness(name) {
	const handlers = {};
	let current = name;
	const set = [];
	const pi = {
		on: (ev, fn) => (handlers[ev] = fn),
		getSessionName: () => current,
		setSessionName: (next) => {
			set.push(next);
			current = next;
			handlers.session_info_changed?.({ name: next }, {});
		},
	};
	naming.default(pi);
	const turn = async (prompt, messageType = "user") => {
		await handlers.before_agent_start({ messageType, prompt }, {});
		return current;
	};
	return { turn, handlers, set, name: () => current };
}

let h = namingHarness(undefined);
await h.handlers.session_start({}, {});
await h.turn("Reply with exactly: OK");
check("name: a handshake names nothing", h.name() === undefined, JSON.stringify(h.set));
await h.turn("Fix the epoch migration in chronicler");
check("name: a multi-turn run is named by its real request", h.name() === "Fix the epoch migration in chronicler", JSON.stringify(h.set));

h = namingHarness(undefined);
await h.handlers.session_start({}, {});
await h.turn("Reply ok");
await h.turn("Reply with exactly: ok");
check("name: repeated handshakes still name nothing", h.set.length === 0, JSON.stringify(h.set));

h = namingHarness(undefined);
await h.handlers.session_start({}, {});
await h.turn('<skill name="recap" location="/home/ta/.agents/skills/recap/SKILL.md">\nbody\n</skill>');
check("name: a skill-only prompt is provisional", h.name() === "/recap", JSON.stringify(h.set));
await h.turn("now check the switch matrix");
check("name: real prose replaces the provisional name", h.name() === "now check the switch matrix", JSON.stringify(h.set));
await h.turn("something else entirely");
check("name: once final, later turns never rename", h.set.length === 2, JSON.stringify(h.set));

h = namingHarness(undefined);
await h.handlers.session_start({}, {});
await h.turn('<skill name="recap">body</skill>');
// The harness's own name stays "/recap": what matters is that the extension saw an external name and
// stopped writing, which is exactly what the real pi would report through session_info_changed.
h.handlers.session_info_changed({ name: "my own name" }, {});
await h.turn("now check the switch matrix");
check("name: /name between turns locks the session", h.set.length === 1, JSON.stringify(h.set));

h = namingHarness(undefined);
await h.turn("Continue the X1C setup. Read ~/x1c-setup-handoff.md first — batch 2: close W02 and W03");
check("name: a handoff preamble keeps its task at 110 chars",
	(h.name() ?? "").endsWith("close W02 and W03") && (h.name() ?? "").length <= 110, h.name());

h = namingHarness("named by --name");
await h.handlers.session_start({}, {});
await h.turn("this must not rename it");
check("name: a resumed session is already locked", h.name() === "named by --name" && h.set.length === 0, JSON.stringify(h.set));

h = namingHarness(undefined);
await h.turn("a custom-message run", "custom");
check("name: only user prompts are named from", h.set.length === 0, JSON.stringify(h.set));

check("name: deriveName keeps a title after a handshake",
	naming.deriveSessionName("Reply ok. epoch migration review").name === "epoch migration review");
check("name: deriveName names a pasted block from inside it",
	naming.deriveSessionName("```\nError: panic at epoch.rs:42\n```").name === "Error: panic at epoch.rs:42");
check("name: deriveName folds newlines before the cut",
	naming.deriveSessionName("Read PLAN.md first.\nThen fix the epoch migration").name === "Read PLAN.md first. Then fix the epoch migration");
check("name: deriveName leaves inline markup alone",
	naming.deriveSessionName("why does `<skill name=\"x\">` strip?").name === 'why does `<skill name="x">` strip?');

process.env.PATH = realPath;
rmSync(scratch, { recursive: true, force: true });
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
	for (const f of failures) console.log(`  ${f}`);
	process.exit(1);
}
