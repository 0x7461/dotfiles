// Tests for the two extensions that act as pi's hooks, since pi has no hook runner of its own:
// store-context.ts (the store prompt, its harness filter and its kill-switch) and notify.ts (the
// desktop notification, its run-length floor and its bounds). Exits non-zero on a failure.
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

process.env.PATH = realPath;
rmSync(scratch, { recursive: true, force: true });
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
	for (const f of failures) console.log(`  ${f}`);
	process.exit(1);
}
