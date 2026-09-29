import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Fills the two gaps between pi's built-in footer and CC's status line (which pi's footer
// otherwise covers: dir, branch, model, thinking level, context %, session cost).
//   - uncommitted file count in the session cwd
//   - OpenCode Go allowance meters: spend over the rolling 5 hours, 7 days and this month,
//     as a share of the caps. Go prices its allowance at the same per-token rates pi uses
//     for `usage.cost`, so summing pi's own session costs approximates Go's meter.
// Estimate, not Go's number: usage from other machines is invisible here, and whether Go's
// windows are rolling or fixed, and its per-model allowances pooled or separate, is
// unverified (harness-migration agent_docs/cost-model.md, checked 2026-09-28).
const GO_PROVIDER = "opencode-go";
const GO_MONTHLY_USD = 60; // V4.1 Flash allowance; the 5h and weekly caps are 20% and 50% of it
const WINDOWS = [
	{ label: "5h", ms: 5 * 3600_000, capUsd: GO_MONTHLY_USD * 0.2 },
	{ label: "7d", ms: 7 * 86400_000, capUsd: GO_MONTHLY_USD * 0.5 },
];
const SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");

function goSpendSince(sinceMs: number): number {
	let usd = 0;
	for (const dir of readdirSync(SESSIONS_DIR, { withFileTypes: true })) {
		if (!dir.isDirectory()) continue;
		for (const name of readdirSync(join(SESSIONS_DIR, dir.name))) {
			const path = join(SESSIONS_DIR, dir.name, name);
			if (!name.endsWith(".jsonl") || statSync(path).mtimeMs < sinceMs) continue;
			for (const line of readFileSync(path, "utf8").split("\n")) {
				if (!line.includes(GO_PROVIDER)) continue;
				let entry;
				try {
					entry = JSON.parse(line);
				} catch {
					continue; // a line pi is still writing
				}
				const msg = entry.message;
				if (entry.type !== "message" || msg?.role !== "assistant" || msg.provider !== GO_PROVIDER) continue;
				if (Date.parse(entry.timestamp) >= sinceMs) usd += msg.usage?.cost?.total ?? 0;
			}
		}
	}
	return usd;
}

function meter(ctx: ExtensionContext, label: string, usd: number, capUsd: number): string {
	const pct = Math.round((usd / capUsd) * 100);
	const text = `${label} ${pct}%`;
	if (pct >= 90) return ctx.ui.theme.fg("error", text);
	if (pct >= 70) return ctx.ui.theme.fg("warning", text);
	return text;
}

function refreshGo(ctx: ExtensionContext) {
	if (ctx.model?.provider !== GO_PROVIDER) {
		ctx.ui.setStatus("go", undefined);
		return;
	}
	const now = Date.now();
	const today = new Date(now);
	const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
	const meters = [
		...WINDOWS.map((w) => meter(ctx, w.label, goSpendSince(now - w.ms), w.capUsd)),
		meter(ctx, "month", goSpendSince(monthStart), GO_MONTHLY_USD),
	];
	ctx.ui.setStatus("go", `go ${meters.join(" · ")}`);
}

function refreshGit(ctx: ExtensionContext) {
	execFile("git", ["-C", ctx.cwd, "status", "--porcelain"], { timeout: 2000 }, (err, stdout) => {
		const count = err ? 0 : stdout.split("\n").filter(Boolean).length;
		ctx.ui.setStatus("git", count ? `${count} uncommitted` : undefined);
	});
}

function refresh(ctx: ExtensionContext) {
	if (!ctx.hasUI) return;
	refreshGit(ctx);
	refreshGo(ctx);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => refresh(ctx));
	pi.on("model_select", async (_event, ctx) => refresh(ctx));
	pi.on("agent_settled", async (_event, ctx) => refresh(ctx));
}
