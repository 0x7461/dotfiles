import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { basename } from "node:path";

// Port of CC's notify.sh hook. pi asks no permissions, so its only "needs you" moment is a
// finished run. Short runs stay silent: a notification after every reply is noise.
const MIN_RUN_MS = 60_000;
// A wedged dbus must not leave the child behind, and a missing notify-send must not be an
// unhandled 'error' event — without a callback, execFile EMITS one, which can end the process.
const NOTIFY_TIMEOUT_MS = 5_000;

export default function (pi: ExtensionAPI) {
	let startedAt: number | undefined;

	// agent_start can fire again on auto-retry or compaction; keep the first one.
	pi.on("agent_start", async () => {
		startedAt ??= Date.now();
	});

	pi.on("agent_settled", async (_event, ctx) => {
		const ranMs = startedAt === undefined ? 0 : Date.now() - startedAt;
		startedAt = undefined;
		if (!ctx.hasUI || ranMs < MIN_RUN_MS) return;
		const minutes = Math.round(ranMs / 60_000);
		execFile(
			"notify-send",
			[
				"--app-name",
				"pi",
				"-t",
				"8000",
				"-u",
				"low",
				"pi finished",
				`${basename(ctx.cwd)}: done after ${minutes} min, waiting for your reply (not urgent)`,
			],
			{ timeout: NOTIFY_TIMEOUT_MS, killSignal: "SIGKILL" },
			(err) => {
				// A non-zero exit is usually transient (no dbus session) and warning every run is the
				// noise this hook exists to avoid. The two structural failures do warn.
				if (!err) return;
				if ((err as NodeJS.ErrnoException).code === "ENOENT") {
					ctx.ui.notify("notify.ts: notify-send is not on PATH, so no desktop notification", "warning");
				} else if (err.killed) {
					ctx.ui.notify(`notify.ts: notify-send still running after ${NOTIFY_TIMEOUT_MS} ms`, "warning");
				}
			},
		);
	});
}
