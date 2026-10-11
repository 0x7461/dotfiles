import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The statusline. Replaces pi's built-in footer via ctx.ui.setFooter, because setStatus()
// can only append a separate line below the footer (footer.js: all status keys are joined
// into one string and pushed as an extra line) — it can never compose into the footer line
// itself. Owning the footer is what statusline-pi (luongnv89/pi-extensions) does, and this
// borrows its layout: one line, segments joined by a muted separator, a Plan/Code/Dump/
// ExDump/Dead zone read off the context window.
//
// Segments, left to right:
//   dir (branch) [changed] │ ctx <tokens> (<%>) <zone> │ <tps> │ CH<pct> │ <spend> │ model • thinking
//
// It carries over the built-in footer's cwd, branch, context %, cache-hit, model and
// thinking level. It drops the ↑input ↓output RcacheRead WcacheWrite totals (rarely
// actionable) and pi's session cost, which is $0 for the DeepSeek provider (no `cost` in
// models.json) — the spend segment below already prices the paid hosts.
//
// The spend segment covers the two paid hosts (ithaca PLAN, Decisions):
//   * opencode-go — flat subscription with capped allowances. Go prices usage at the same
//     per-token rates pi records in `usage.cost`, so summing those approximates Go's meter.
//   * deepseek (direct, prepaid) — the balance from DeepSeek's API is the ground truth and
//     account-wide. Month spend is priced here from token counts, because pi records $0 for
//     providers without `cost` in models.json, and one flat rate can't express peak hours.
// Both spend figures cover this machine's pi sessions only.
const HOME = homedir();
const SESSIONS_DIR = join(HOME, ".pi", "agent", "sessions");
const SPEED_THROTTLE_MS = 250;

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

// statusline-pi's zones. A 1M-class window steps on absolute tokens; anything smaller
// steps on the used ratio. Both DeepSeek models declare a 1M window (models.json).
function contextZone(
	usedTokens: number,
	contextWindow: number,
): "Plan" | "Code" | "Dump" | "ExDump" | "Dead" {
	if (contextWindow >= 500_000) {
		if (usedTokens < 150_000) return "Plan";
		if (usedTokens < 250_000) return "Code";
		if (usedTokens < 400_000) return "Dump";
		if (usedTokens < 450_000) return "ExDump";
		return "Dead";
	}
	const ratio = contextWindow > 0 ? usedTokens / contextWindow : 0;
	if (ratio < 0.4) return "Plan";
	if (ratio < 0.7) return "Code";
	if (ratio < 0.75) return "Dump";
	if (ratio < 0.8) return "ExDump";
	return "Dead";
}

// Only the zones that call for action carry colour, so the zone word is the signal and the
// colour never the only one.
function contextZoneColor(zone: string): "warning" | "error" | undefined {
	if (zone === "Dead") return "error";
	if (zone === "Dump" || zone === "ExDump") return "warning";
	return undefined;
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

interface FooterState {
	dir?: string;
	branch?: string;
	changed: number;
	ctx?: string;
	tps?: string;
	cache?: string;
	spend?: string;
	provider?: string;
	model?: string;
	thinking?: string;
	reasoning: boolean;
}

function shortenHome(path: string): string {
	const home = process.env.HOME;
	return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function formatHead(theme: any, state: FooterState, branch: string | undefined): string | undefined {
	if (!state.dir) return undefined;
	let text = theme.fg("dim", state.dir);
	if (branch) text += ` ${theme.fg("mdLink", `(${branch})`)}`;
	if (state.changed > 0) text += ` ${theme.fg("warning", `[${state.changed}]`)}`;
	return text;
}

function formatModel(theme: any, state: FooterState, footerData: any): string | undefined {
	if (!state.model) return undefined;
	let text = state.reasoning && state.thinking ? `${state.model} • ${state.thinking}` : state.model;
	if (state.provider && (footerData?.getAvailableProviderCount?.() ?? 1) > 1) text = `(${state.provider}) ${text}`;
	return theme.fg("muted", text);
}

export default function (pi: ExtensionAPI) {
	const state: FooterState = { changed: 0, reasoning: false };
	let requestRender: (() => void) | undefined;

	// Average output speed over completed responses, plus the in-flight response once it has
	// produced text. Estimated at four characters per token, as statusline-pi does.
	let responseStartMs: number | undefined;
	let liveOutputChars = 0;
	let completedOutputTokens = 0;
	let completedDurationMs = 0;
	let lastSpeedRender = 0;

	function compose(width: number, theme: any, footerData: any): string[] {
		const branch = footerData?.getGitBranch?.() ?? state.branch;
		const sep = theme.fg("borderMuted", " │ ");
		const head = formatHead(theme, state, branch);
		const model = formatModel(theme, state, footerData);
		const wide = [head, state.ctx, state.tps, state.cache, state.spend, model].filter(Boolean).join(sep);
		if (visibleWidth(wide) <= width) return [wide];
		// Narrow terminal: two lines, the session-hygiene half then the spend half.
		const line1 = [head, state.ctx, state.tps].filter(Boolean).join(sep);
		const line2 = [state.cache, state.spend, model].filter(Boolean).join(sep);
		return [
			truncateToWidth(line1, width, theme.fg("dim", "...")),
			truncateToWidth(line2, width, theme.fg("dim", "...")),
		];
	}

	function mount(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;
		ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
			requestRender = () => tui.requestRender();
			const unsubscribe = footerData.onBranchChange?.(() => {
				updateGit(ctx);
				tui.requestRender();
			});
			return {
				dispose() {
					unsubscribe?.();
					requestRender = undefined;
				},
				invalidate() {
					tui.requestRender();
				},
				render(width: number) {
					return compose(width, theme, footerData);
				},
			};
		});
	}

	function refreshContext(ctx: ExtensionContext) {
		const usage = ctx.getContextUsage();
		if (!usage || usage.tokens == null) {
			state.ctx = undefined;
			return;
		}
		const zone = contextZone(usage.tokens, usage.contextWindow);
		const color = contextZoneColor(zone);
		const pct = usage.percent != null ? `${Math.round(usage.percent)}%` : "?";
		state.ctx = [
			`ctx ${Math.floor(usage.tokens / 1000)}K`,
			ctx.ui.theme.fg("dim", `(${pct})`),
			color ? ctx.ui.theme.fg(color, zone) : zone,
		].join(" ");
	}

	function updateGit(ctx: ExtensionContext) {
		execFile("git", ["-C", ctx.cwd, "status", "--porcelain"], { timeout: 2000 }, (err, stdout) => {
			state.changed = err ? 0 : stdout.split("\n").filter(Boolean).length;
			requestRender?.();
		});
	}

	async function refreshSpend(ctx: ExtensionContext) {
		const provider = ctx.model?.provider;
		if (provider === "opencode-go") state.spend = goStatus(ctx);
		else if (provider === "deepseek") state.spend = await deepseekStatus(ctx);
		else state.spend = undefined;
		requestRender?.();
	}

	// Cache-hit rate of the latest assistant response. DeepSeek prices a cache hit at 50x
	// less than a miss (see DEEPSEEK_PEAK), so this is the main lever on cost.
	function cacheHitText(usage: any): string | undefined {
		const prompt = (usage?.input ?? 0) + (usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0);
		return prompt > 0 ? `CH ${(((usage.cacheRead ?? 0) / prompt) * 100).toFixed(1)}%` : undefined;
	}

	function seedCache(ctx: ExtensionContext) {
		let text: string | undefined;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type !== "message") continue;
			const message: any = entry.message;
			if (message?.role !== "assistant") continue;
			text = cacheHitText(message.usage) ?? text;
		}
		state.cache = text;
	}

	function speedText(): string | undefined {
		const streaming = responseStartMs !== undefined;
		const tokens = completedOutputTokens + (streaming ? liveOutputChars / 4 : 0);
		const ms = completedDurationMs + (streaming ? Date.now() - responseStartMs! : 0);
		if (tokens <= 0 || ms <= 0) return undefined;
		const tps = tokens / (ms / 1000);
		return `${tps < 100 ? tps.toFixed(1) : Math.round(tps)} tps`;
	}

	function refreshSpeed(force = false) {
		const now = Date.now();
		if (!force && responseStartMs !== undefined && now - lastSpeedRender < SPEED_THROTTLE_MS) return;
		lastSpeedRender = now;
		state.tps = speedText();
		requestRender?.();
	}

	function resetSpeed() {
		responseStartMs = undefined;
		liveOutputChars = 0;
		completedOutputTokens = 0;
		completedDurationMs = 0;
		lastSpeedRender = 0;
		state.tps = undefined;
	}

	function setModel(ctx: ExtensionContext) {
		state.provider = ctx.model?.provider;
		state.model = ctx.model?.id?.replace(/^models\//, "");
		state.reasoning = ctx.model?.reasoning ?? false;
		state.thinking = pi.getThinkingLevel?.() ?? "off";
	}

	async function refresh(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;
		refreshContext(ctx);
		updateGit(ctx);
		await refreshSpend(ctx);
	}

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		state.dir = shortenHome(ctx.cwd);
		state.branch = undefined;
		state.changed = 0;
		setModel(ctx);
		seedCache(ctx);
		mount(ctx);
		await refresh(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		setModel(ctx);
		resetSpeed();
		await refresh(ctx);
	});

	pi.on("thinking_level_select", async (_event, ctx) => {
		state.thinking = pi.getThinkingLevel?.() ?? "off";
		void ctx;
		requestRender?.();
	});

	pi.on("agent_settled", async (_event, ctx) => refresh(ctx));

	pi.on("message_start", (event, ctx) => {
		if (event.message.role !== "assistant") return;
		responseStartMs = Date.now();
		liveOutputChars = 0;
		refreshSpeed(true);
		void ctx;
	});

	pi.on("message_update", (event, ctx) => {
		if (event.message.role !== "assistant" || responseStartMs === undefined) return;
		const chunk = event.assistantMessageEvent;
		if (chunk.type === "text_delta" || chunk.type === "thinking_delta" || chunk.type === "toolcall_delta") {
			liveOutputChars += chunk.delta.length;
		}
		refreshSpeed();
		void ctx;
	});

	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "assistant") return;
		const usage: any = event.message.usage;
		const outputTokens = usage?.output ?? 0;
		const durationMs = responseStartMs === undefined ? 0 : Date.now() - responseStartMs;
		if (responseStartMs !== undefined && outputTokens > 0 && durationMs > 0) {
			completedOutputTokens += outputTokens;
			completedDurationMs += durationMs;
		}
		responseStartMs = undefined;
		liveOutputChars = 0;
		state.cache = cacheHitText(usage) ?? state.cache;
		refreshSpeed(true);
		void ctx;
	});
}
