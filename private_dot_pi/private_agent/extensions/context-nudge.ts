import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// pi never warns before auto-compacting: it truncates at `reserveTokens` (16384 by default) with no
// prompt. The store's continuation work needs the warning it lacks, so this is the soft pressure
// that replaces a quit gate: three levels, once each per session, each naming the action that
// costs least at that point. Percent comes from ctx.getContextUsage(), which is already relative to
// the active model's window, so a model switch needs no special case — and it is the same number
// the footer shows, so two percentages never compete.
const LEVELS = [
	{ at: 25, text: "a checkpoint now is cheap and complete", level: "info" as const },
	{ at: 50, text: "checkpoint before a switch or a long detour", level: "info" as const },
	{ at: 75, text: "pi compacts at its reserve soon; checkpoint now", level: "warning" as const },
];

export default function (pi: ExtensionAPI) {
	const fired = new Set<number>();

	// A compaction drops usage back to near zero; re-arming keeps the next climb visible. Without
	// this a long session gets three nudges total, and the ones after the first compaction are the
	// ones that matter.
	pi.on("session_compact", async () => {
		fired.clear();
	});

	pi.on("turn_end", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		const usage = ctx.getContextUsage();
		const percent = usage?.percent;
		// percent is null right after a compaction, before the next response reports tokens.
		if (percent === null || percent === undefined) return;

		for (const { at, text, level } of LEVELS) {
			if (percent < at || fired.has(at)) continue;
			fired.add(at);
			ctx.ui.notify(`context ${Math.round(percent)}% — ${text}`, level);
		}
	});
}
