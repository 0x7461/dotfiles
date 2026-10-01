import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Port of CC's audit-commands.sh hook: every bash command the agent runs is appended to the
// same log, in the same "[YYYY-MM-DD HH:MM:SS] cmd" format (local time), before it executes.
// chronicler archives this file as its `cmdlog` source and /recap reads it, so pi commands
// stay traceable after the CC cutover. A failed write warns instead of blocking the command.
const LOG = join(homedir(), ".claude", "command-history.log");

function localTimestamp(d: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event) || !event.input.command) return;
		try {
			appendFileSync(LOG, `[${localTimestamp(new Date())}] ${event.input.command}\n`);
		} catch (err) {
			ctx.ui.notify(`audit-commands: could not write ${LOG}: ${err}`, "error");
		}
	});
}
