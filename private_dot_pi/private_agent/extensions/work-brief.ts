import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

// The work brief: three lines about what is open on *this checkout*, injected once per session at the
// end of the system prompt (ithaca continuation contract §13).
//
// Passive on purpose. A greeting turn would bill every fresh session before the user has typed, and
// only pi could do it — so it would diverge from three harnesses for cosmetics. The brief costs no
// turn: it rides in the prompt the session was going to send anyway.
//
// Keyed on the *place*, not the intent: at session start nothing has been said, so the only honest
// question is "what was open here". Intent-keyed search is `enter`, run once the user speaks. A
// branch match is the case no lexical score can find, which is why the place is the right key.
//
// It goes last, after store-context's snapshot, so the store text stays the cached prefix and only
// this tail differs per session.
const CLI = join(homedir(), ".agents", "scripts", "ithaca-context.py");
const TIMEOUT_MS = 5000;

let brief: string | undefined;

function workBrief(ctx: { mode?: string; hasUI?: boolean; ui?: { notify: (m: string, l?: string) => void } }): string {
	// TUI only: print, JSON and RPC runs are programmatic, and a pi-worker run must not pay for a
	// brief it cannot act on.
	if (ctx.mode !== "tui") return "";
	try {
		return execFileSync("python3", [CLI, "brief"], {
			encoding: "utf8",
			timeout: TIMEOUT_MS,
			cwd: process.cwd(),
		}).trim();
	} catch (error) {
		// Injecting nothing is right; injecting a wrong or half-read brief is not. Staying silent
		// about the failure is also wrong — this layer exists to stop a session continuing blind, so
		// the fault is named in the UI and the session runs without the brief rather than with one.
		if (ctx.hasUI) ctx.ui?.notify(`work brief unavailable: ${(error as Error).message}`, "warning");
		return "";
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		brief = workBrief(ctx as never);
	});
	pi.on("before_agent_start", async (event) => {
		if (!brief) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${brief}` };
	});
}
