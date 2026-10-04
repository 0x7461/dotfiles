import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Fills the gaps between pi's built-in footer and CC's status line (pi's footer already
// shows dir, branch, model, thinking level, context % and session cost):
//   - uncommitted file count in the session cwd
//   - what the active paid provider has left, which CC showed as its 5h/7d limit meters.
//     Two hosts are in play (ithaca PLAN, Decisions):
//     * opencode-go — flat subscription with capped allowances. Go prices usage at the same
//       per-token rates pi records in `usage.cost`, so summing those approximates Go's meter.
//     * deepseek (direct, prepaid) — the balance from DeepSeek's API is the ground truth and
//       account-wide. Month spend is priced here from token counts, because pi records $0 for
//       providers without `cost` in models.json, and one flat rate can't express peak hours.
// Both spend figures cover this machine's pi sessions only.
const HOME = homedir();
const SESSIONS_DIR = join(HOME, ".pi", "agent", "sessions");

// OpenCode Go, V4.1 Flash allowance (checked 2026-09-28): $60/mo, 5h cap 20%, weekly 50%.
// Unverified: rolling vs fixed windows, pooled vs per-model allowances.
const GO_MONTHLY_USD = 60;
const GO_WINDOWS = [
	{ label: "5h", ms: 5 * 3600_000, capUsd: GO_MONTHLY_USD * 0.2 },
	{ label: "7d", ms: 7 * 86400_000, capUsd: GO_MONTHLY_USD * 0.5 },
];

// DeepSeek peak rates, $/1M tokens (api-docs.deepseek.com/quick_start/pricing, 2026-09-29).
// Off-peak is half. `deepseek-v4-flash` is a legacy name billed as `deepseek-flash`.
// No cache-write price: a cache miss is plain input.
const DEEPSEEK_PEAK: Record<string, { hit: number; miss: number; out: number }> = {
	"deepseek-flash": { hit: 0.006, miss: 0.3, out: 1.2 },
	"deepseek-v4-flash": { hit: 0.006, miss: 0.3, out: 1.2 },
	"deepseek-v4-pro": { hit: 0.044, miss: 1.32, out: 3.96 },
};
const DEEPSEEK_KEY = join(HOME, ".config", "deepseek", "key_void");
const NAGGER_CONFIG = join(HOME, ".config", "guild", "nagger.json"); // spend_quota_usd (exit-map §6)
const BALANCE_TTL_MS = 60_000;

// Peak: 01:00-04:00 and 06:00-10:00 UTC, Monday to Friday. Chinese public holidays are
// off-peak but not modelled, so a holiday is priced as peak — an overestimate, never under.
function deepseekIsPeak(ms: number): boolean {
	const d = new Date(ms);
	const day = d.getUTCDay();
	const hour = d.getUTCHours();
	return day >= 1 && day <= 5 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
}

type Assistant = { ms: number; provider: string; model: string; usage: any };

// Assistant messages from every session file touched since `sinceMs`.
function assistantMessagesSince(sinceMs: number, provider: string): Assistant[] {
	const found: Assistant[] = [];
	for (const dir of readdirSync(SESSIONS_DIR, { withFileTypes: true })) {
		if (!dir.isDirectory()) continue;
		for (const name of readdirSync(join(SESSIONS_DIR, dir.name))) {
			const path = join(SESSIONS_DIR, dir.name, name);
			if (!name.endsWith(".jsonl") || statSync(path).mtimeMs < sinceMs) continue;
			for (const line of readFileSync(path, "utf8").split("\n")) {
				if (!line.includes(`"provider":"${provider}"`)) continue;
				let entry;
				try {
					entry = JSON.parse(line);
				} catch {
					continue; // a line pi is still writing
				}
				const msg = entry.message;
				if (entry.type !== "message" || msg?.role !== "assistant" || msg.provider !== provider) continue;
				const ms = Date.parse(entry.timestamp);
				if (ms >= sinceMs) found.push({ ms, provider, model: msg.model, usage: msg.usage ?? {} });
			}
		}
	}
	return found;
}

function monthStart(now: number): number {
	const d = new Date(now);
	return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function heat(ctx: ExtensionContext, pct: number, text: string): string {
	if (pct >= 90) return ctx.ui.theme.fg("error", text);
	if (pct >= 70) return ctx.ui.theme.fg("warning", text);
	return text;
}

function goStatus(ctx: ExtensionContext): string {
	const now = Date.now();
	const spend = (since: number) =>
		assistantMessagesSince(since, "opencode-go").reduce((usd, m) => usd + (m.usage.cost?.total ?? 0), 0);
	const meter = (label: string, usd: number, capUsd: number) => {
		const pct = Math.round((usd / capUsd) * 100);
		return heat(ctx, pct, `${label} ${pct}%`);
	};
	const meters = [
		...GO_WINDOWS.map((w) => meter(w.label, spend(now - w.ms), w.capUsd)),
		meter("month", spend(monthStart(now)), GO_MONTHLY_USD),
	];
	return `go ${meters.join(" · ")}`;
}

let balance: { text: string; at: number } | undefined;

async function deepseekBalance(): Promise<string> {
	if (balance && Date.now() - balance.at < BALANCE_TTL_MS) return balance.text;
	let text: string;
	try {
		const key = readFileSync(DEEPSEEK_KEY, "utf8").trim();
		const res = await fetch("https://api.deepseek.com/user/balance", {
			headers: { Authorization: `Bearer ${key}` },
			signal: AbortSignal.timeout(5000),
		});
		const info = (await res.json()).balance_infos?.find((b: any) => b.currency === "USD");
		text = info ? `$${Number(info.total_balance).toFixed(2)} left` : `balance ? (HTTP ${res.status})`;
	} catch (err) {
		text = `balance ? (${(err as any).code ?? (err as Error).name})`;
	}
	balance = { text, at: Date.now() };
	return text;
}

function deepseekMonthSpend(now: number): { usd: number; unpriced: boolean } {
	let usd = 0;
	let unpriced = false;
	for (const m of assistantMessagesSince(monthStart(now), "deepseek")) {
		const peak = DEEPSEEK_PEAK[m.model];
		if (!peak) {
			unpriced = true;
			continue;
		}
		const factor = deepseekIsPeak(m.ms) ? 1 : 0.5;
		const u = m.usage;
		usd += (factor * ((u.cacheRead ?? 0) * peak.hit + ((u.input ?? 0) + (u.cacheWrite ?? 0)) * peak.miss + (u.output ?? 0) * peak.out)) / 1e6;
	}
	return { usd, unpriced };
}

function spendQuota(): number | undefined {
	if (!existsSync(NAGGER_CONFIG)) return undefined;
	const quota = JSON.parse(readFileSync(NAGGER_CONFIG, "utf8")).spend_quota_usd;
	return typeof quota === "number" && quota > 0 ? quota : undefined;
}

async function deepseekStatus(ctx: ExtensionContext): Promise<string> {
	const { usd, unpriced } = deepseekMonthSpend(Date.now());
	let month = `month $${usd.toFixed(2)}${unpriced ? "+?" : ""}`;
	const quota = spendQuota();
	if (quota) {
		const pct = Math.round((usd / quota) * 100);
		month = heat(ctx, pct, `${month}/$${quota} (${pct}%)`);
	}
	return `deepseek ${await deepseekBalance()} · ${month}`;
}

async function refreshSpend(ctx: ExtensionContext) {
	const provider = ctx.model?.provider;
	if (provider === "opencode-go") ctx.ui.setStatus("spend", goStatus(ctx));
	else if (provider === "deepseek") ctx.ui.setStatus("spend", await deepseekStatus(ctx));
	else ctx.ui.setStatus("spend", undefined);
}

function refreshGit(ctx: ExtensionContext) {
	execFile("git", ["-C", ctx.cwd, "status", "--porcelain"], { timeout: 2000 }, (err, stdout) => {
		const count = err ? 0 : stdout.split("\n").filter(Boolean).length;
		ctx.ui.setStatus("git", count ? `${count} uncommitted` : undefined);
	});
}

async function refresh(ctx: ExtensionContext) {
	if (!ctx.hasUI) return;
	refreshGit(ctx);
	await refreshSpend(ctx);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => refresh(ctx));
	pi.on("model_select", async (_event, ctx) => refresh(ctx));
	pi.on("agent_settled", async (_event, ctx) => refresh(ctx));
}
