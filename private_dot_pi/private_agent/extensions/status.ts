import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
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
//   dir (branch) [changed] │ ctx <tokens> (<%>) <zone> │ <tps> │ CH<pct> │ left 5h N% …   …   model • thinking | ⚡87% | 14:32
//
// The model is right-aligned to the terminal edge, as the built-in footer did.
//
// It carries over the built-in footer's cwd, branch, context %, cache-hit, model and
// thinking level. It drops the ↑input ↓output RcacheRead WcacheWrite totals (rarely
// actionable) and pi's session cost — the spend segment below prices the paid host itself.
//
// The spend segment covers the one paid host (ithaca PLAN, Decisions): opencode-go — a flat
// subscription with one shared usage quota, not a set of independent per-model buckets. The
// per-model dollar figures Go publishes are *rates*: a dollar spent on a $15 model consumes
// four times the quota a dollar on a $60 model does, and the plan meter is the sum of those
// fractions (Go reports it per request as `opencode.allowance`; pi drops that field, so it is
// recomputed from tokens here). The 5-hour window allows 20% of the monthly quota, the week
// 50%. The week and the billing cycle are fixed buckets — anchored to the console's own reset
// instants below — while the 5-hour one is treated as rolling. The segment reports what is
// **left**, not what is spent: the number you act on is headroom, and colour still follows
// consumption, so a comfortable remainder never reads green while it is actually running out. The direct lane is closed
// (2026-10-19). The figure covers this machine's pi sessions only, so it reads a little under
// the console (unlogged retries and aborted streams are billed upstream), and Go can bill
// extra usage to the Console balance past 100% — the meter keeps climbing rather than
// stopping there.
const HOME = homedir();
const SESSIONS_DIR = join(HOME, ".pi", "agent", "sessions");
// pi-worker (the pi-worker skill) runs its pi child with `--session-dir <run>/sessions`, so
// delegated work never lands under SESSIONS_DIR. It defaults to a cheap model but escalates to
// DeepSeek Pro, so leaving it out under-counts exactly the expensive turns.
const WORKER_RUNS_DIR = join(HOME, ".local", "state", "pi-worker");
const SPEED_THROTTLE_MS = 250;

// OpenCode Go pricing (opencode.ai/docs/go, 2026-10-26; cost model:
// opencode.ai/v2/docs/console/api/inference → Cost). Go's budget is one shared quota, and the
// per-model dollar figures below are rates against it: each model's `monthly` is the bucket
// its dollars are measured in, so one dollar on a $15 model is worth four on a $60 model.
// Re-check the buckets when Go reprices — DeepSeek's moved twice in two days in the 2026-10
// reshuffle, and both the bucket and the token price changed at once.
//
// Rates are $/1M tokens at list price. `write` is a priced cache write (Kimi, Qwen, GPT
// Luna); where Go doesn't price it, an unwritten cache bills as plain input. `tiers` are
// context-length bands, shortest first — the last entry applies above its predecessor.
// DeepSeek is the only peak-priced family (2x on Mon-Fri 01:00-04:00 & 06:00-10:00 UTC).
type GoRate = { hit: number; miss: number; out: number; write?: number };
type GoTier = { upTo?: number; rate: GoRate };
type GoModel = { monthly: number; tiers: GoTier[]; peakFactor?: number; promoUntil?: string };

const GO_PROMO_FACTOR = 0.5; // Gemini 4 Argon: 50% off through 2026-11-30

const GO_MODELS: Record<string, GoModel> = {
	"deepseek-v4-pro": {
		monthly: 15,
		peakFactor: 2,
		tiers: [{ rate: { hit: 0.022, miss: 0.66, out: 1.98 } }],
	},
	"deepseek-v4.1-flash": {
		monthly: 80,
		peakFactor: 2,
		tiers: [{ rate: { hit: 0.003, miss: 0.15, out: 0.6 } }],
	},
	"deepseek-v4-flash": {
		monthly: 80, // legacy id; billed as v4.1
		peakFactor: 2,
		tiers: [{ rate: { hit: 0.003, miss: 0.15, out: 0.6 } }],
	},
	// Go's page lists `gemini-4-argon`; pi's catalog uses the -contributor id. Price both,
	// and check the training terms before pointing private work at the contributor id.
	"gemini-4-argon": {
		monthly: 30,
		promoUntil: "2026-11-30T23:59:59Z",
		tiers: [{ rate: { hit: 0.2, miss: 4, out: 20 } }],
	},
	"gemini-4-argon-contributor": {
		monthly: 30,
		promoUntil: "2026-11-30T23:59:59Z",
		tiers: [{ rate: { hit: 0.2, miss: 4, out: 20 } }],
	},
	"claude-haiku-5-5": {
		monthly: 15,
		tiers: [
			{ upTo: 100_000, rate: { hit: 0.01, miss: 0.1, out: 0.5, write: 0.125 } },
			{ rate: { hit: 0.05, miss: 0.5, out: 2.5, write: 0.625 } },
		],
	},
	"gpt-6-luna": {
		monthly: 15,
		tiers: [
			{ upTo: 272_000, rate: { hit: 0.01, miss: 0.1, out: 0.5, write: 0.125 } },
			{ rate: { hit: 0.02, miss: 0.2, out: 0.75, write: 0.25 } },
		],
	},
	"gpt-5.6-luna": {
		monthly: 15,
		tiers: [
			{ upTo: 272_000, rate: { hit: 0.02, miss: 0.2, out: 1.2, write: 0.25 } },
			{ rate: { hit: 0.04, miss: 0.4, out: 1.8, write: 0.5 } },
		],
	},
	"grok-4.7": {
		monthly: 15,
		tiers: [
			{ upTo: 200_000, rate: { hit: 0.5, miss: 2, out: 6 } },
			{ rate: { hit: 1, miss: 4, out: 12 } },
		],
	},
	"kimi-k3": { monthly: 15, tiers: [{ rate: { hit: 0.3, miss: 3, out: 15, write: 3 } }] },
	"kimi-k3.1-pro": { monthly: 15, tiers: [{ rate: { hit: 0.2, miss: 2, out: 10, write: 2 } }] },
	"kimi-k2.7-code": { monthly: 60, tiers: [{ rate: { hit: 0.19, miss: 0.95, out: 4 } }] },
	"qwen3.8-max": { monthly: 15, tiers: [{ rate: { hit: 0.25, miss: 2, out: 6, write: 2.5 } }] },
	"qwen3.8-flash": { monthly: 30, tiers: [{ rate: { hit: 0.016, miss: 0.15, out: 0.47, write: 0.2 } }] },
	"qwen3.7-plus": {
		monthly: 60,
		tiers: [
			{ upTo: 256_000, rate: { hit: 0.04, miss: 0.4, out: 1.6, write: 0.5 } },
			{ rate: { hit: 0.12, miss: 1.2, out: 4.8, write: 1.5 } },
		],
	},
	"glm-5.3": { monthly: 15, tiers: [{ rate: { hit: 0.26, miss: 1.4, out: 4.4 } }] },
	"glm-5.3-flash": { monthly: 60, tiers: [{ rate: { hit: 0.03, miss: 0.15, out: 0.5 } }] },
	"glm-5.2": { monthly: 60, tiers: [{ rate: { hit: 0.26, miss: 1.4, out: 4.4 } }] },
	"minimax-m3": { monthly: 60, tiers: [{ rate: { hit: 0.06, miss: 0.3, out: 1.2 } }] },
	"minimax-m3.1-flash": { monthly: 20, tiers: [{ rate: { hit: 0.015, miss: 0.15, out: 0.6 } }] },
	"mimo-v2.6-flash": { monthly: 60, tiers: [{ rate: { hit: 0.0028, miss: 0.14, out: 0.28 } }] },
	"mimo-v2.6-pro": { monthly: 15, tiers: [{ rate: { hit: 0.003625, miss: 0.435, out: 0.87 } }] },
	"mimo-v2.5": { monthly: 60, tiers: [{ rate: { hit: 0.0028, miss: 0.14, out: 0.28 } }] },
	"mimo-v2.5-pro": { monthly: 15, tiers: [{ rate: { hit: 0.003625, miss: 0.435, out: 0.87 } }] },
	"hy3": { monthly: 60, tiers: [{ rate: { hit: 0.035, miss: 0.14, out: 0.58 } }] },
	"hy4-preview": { monthly: 30, tiers: [{ rate: { hit: 0.042, miss: 0.834, out: 2.501 } }] },
	"longcat-2.0": { monthly: 60, tiers: [{ rate: { hit: 0.006, miss: 0.3, out: 1.2 } }] },
	"step-5-preview": { monthly: 15, tiers: [{ rate: { hit: 0.1, miss: 1, out: 2.7 } }] },
	"muse-spark-1.3-contributor": { monthly: 60, tiers: [{ rate: { hit: 0.002, miss: 0.1, out: 0.2 } }] },
	"muse-spark-1.2-contributor": { monthly: 60, tiers: [{ rate: { hit: 0.002, miss: 0.1, out: 0.2 } }] },
	// Free-tier ids: no allowance to spend, so a meter reading 0% is the honest answer.
	"beam-free": { monthly: Infinity, tiers: [{ rate: { hit: 0, miss: 0, out: 0 } }] },
	"longcat-2.5-preview-free": { monthly: Infinity, tiers: [{ rate: { hit: 0, miss: 0, out: 0 } }] },
	"minimax-m3.1-flash-free": { monthly: Infinity, tiers: [{ rate: { hit: 0, miss: 0, out: 0 } }] },
};

// Unknown model: assume the smallest common allowance so the meter errs toward warn.
const GO_MONTHLY_USD_DEFAULT = 15;

// Go's week and cycle are fixed buckets on the subscription's own schedule, not rolling
// windows: a rolling 7d keeps counting the previous week's usage, so it read 91% while the
// console said 0% (2026-10-26). Both reset instants come from the console's Go page — weekly
// Mondays 07:00, cycle renews on the 19th around 22:30, Asia/Ho_Chi_Minh — and are advanced
// here rather than stored per session. Re-seed when the plan or billing anchor changes; a
// stale seed shows plausible percentages with no way to notice.
const GO_WEEK_RESET_SEED = "2026-11-02T07:00:00+07:00";
const GO_CYCLE_RESET_SEED = "2026-11-19T22:30:00+07:00";
const WEEK_MS = 7 * 86400_000;

// Month arithmetic that clamps to the target month's length, so a seed on the 31st doesn't
// roll into the next month.
function plusMonths(t: number, n: number): number {
	const d = new Date(t);
	const day = d.getUTCDate();
	const target = new Date(t);
	target.setUTCDate(1);
	target.setUTCMonth(target.getUTCMonth() + n);
	const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
	target.setUTCDate(Math.min(day, lastDay));
	return target.getTime();
}

// Start of the bucket containing `now`: advance the seed to the next reset, then step back one
// period. Rolling windows would over-count right after a reset, which is the case that matters.
function goWeeklyStart(now: number): number {
	let reset = Date.parse(GO_WEEK_RESET_SEED);
	while (reset <= now) reset += WEEK_MS;
	return reset - WEEK_MS;
}

function goCycleStart(now: number): number {
	let reset = Date.parse(GO_CYCLE_RESET_SEED);
	while (reset <= now) reset = plusMonths(reset, 1);
	return plusMonths(reset, -1);
}

function goIsPeak(ms: number): boolean {
	const d = new Date(ms);
	const day = d.getUTCDay();
	const hour = d.getUTCHours();
	return day >= 1 && day <= 5 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
}

type Assistant = { ms: number; provider: string; model: string; usage: any };

// Every session file under `dir` touched since `sinceMs`, walked because a pi session dir holds
// one subdirectory per project.
function sessionFilesSince(dir: string, sinceMs: number, depth = 3): string[] {
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return []; // absent root: interactive sessions always exist, worker runs may not
	}
	const out: string[] = [];
	for (const name of names) {
		const path = join(dir, name);
		let st;
		try {
			st = statSync(path);
		} catch {
			continue;
		}
		if (st.isDirectory()) {
			if (depth > 0) out.push(...sessionFilesSince(path, sinceMs, depth - 1));
		} else if (name.endsWith(".jsonl") && st.mtimeMs >= sinceMs) out.push(path);
	}
	return out;
}

// Assistant messages from every session file touched since `sinceMs`, interactive and delegated.
function assistantMessagesSince(sinceMs: number, provider: string): Assistant[] {
	const found: Assistant[] = [];
	const files = [
		...sessionFilesSince(SESSIONS_DIR, sinceMs),
		...sessionFilesSince(WORKER_RUNS_DIR, sinceMs, 4),
	];
	for (const path of files) {
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
	return found;
}

function heat(ctx: ExtensionContext, pct: number, text: string): string {
	if (pct >= 90) return ctx.ui.theme.fg("error", text);
	if (pct >= 70) return ctx.ui.theme.fg("warning", text);
	return text;
}

// statusline-pi's zones. A 1M-class window steps on absolute tokens; anything smaller
// steps on the used ratio. Both DeepSeek models declare a 1M window.
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

// Rate in force for a message: the band its prompt size falls in, then the peak multiplier
// and any dated promo, both evaluated at the message's own timestamp rather than now.
function goRateAt(m: GoModel, promptTokens: number, ms: number): GoRate {
	const tier = m.tiers.find((t) => t.upTo === undefined || promptTokens <= t.upTo) ?? m.tiers[m.tiers.length - 1];
	const r = tier.rate;
	const factor =
		(m.peakFactor && goIsPeak(ms) ? m.peakFactor : 1) *
		(m.promoUntil && ms <= Date.parse(m.promoUntil) ? GO_PROMO_FACTOR : 1);
	if (factor === 1) return r;
	return {
		hit: r.hit * factor,
		miss: r.miss * factor,
		out: r.out * factor,
		write: r.write && r.write * factor,
	};
}

// One message's share of the monthly quota: its price divided by its model's bucket. Unknown
// models fall back to pi's `usage.cost` against the smallest bucket, so the meter errs toward
// warn rather than reading free.
function goConsumption(m: Assistant): number {
	const go = GO_MODELS[m.model];
	if (!go) return (m.usage.cost?.total ?? 0) / GO_MONTHLY_USD_DEFAULT;
	if (!Number.isFinite(go.monthly)) return 0;
	return priceMessage(m, go) / go.monthly;
}

// Price one assistant message from its tokens. Unknown models fall back to pi's flat
// `usage.cost`, so the meter never reads $0 for them.
function priceMessage(m: Assistant, go: GoModel | undefined): number {
	if (!go) return m.usage.cost?.total ?? 0;
	const u = m.usage;
	const prompt = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
	const r = goRateAt(go, prompt, m.ms);
	return (
		(u.cacheRead ?? 0) * r.hit +
		(u.input ?? 0) * r.miss +
		(u.cacheWrite ?? 0) * (r.write ?? r.miss) +
		(u.output ?? 0) * r.out
	) / 1e6;
}

function goStatus(ctx: ExtensionContext): string {
	const now = Date.now();
	// Every model feeds the same quota, so the windows sum all of them, not just the active one.
	const share = (since: number) =>
		assistantMessagesSince(since, "opencode-go").reduce((quota, m) => quota + goConsumption(m), 0);
	// Headroom, not consumption: `5h 98%` means 2% spent. Colour keys off the part spent, so the
	// text can show what is left without a healthy-looking number hiding a nearly-spent window.
	// Past 100% Go bills the Console balance instead, so absence of headroom reads `over`.
	const meter = (label: string, used: number, cap: number) => {
		const spent = Math.round((used / cap) * 100);
		const left = 100 - spent;
		return heat(ctx, spent, `${label} ${left >= 0 ? `${left}%` : `${-left}% over`}`);
	};
	const meters = [
		meter("5h", share(now - 5 * 3600_000), 0.2),
		meter("wk", share(goWeeklyStart(now)), 0.5),
		meter("month", share(goCycleStart(now)), 1),
	];
	return `left ${meters.join(" · ")}`;
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
	battery?: string;
	clock?: string;
}

function shortenHome(path: string): string {
	const home = process.env.HOME;
	return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

// Pad `left` so `right` sits flush against the terminal's right edge, as the built-in
// footer right-aligned the model. Returns undefined when the two would collide.
function rightAlign(left: string, right: string, width: number): string | undefined {
	const gap = width - visibleWidth(left) - visibleWidth(right);
	return gap >= 2 ? left + " ".repeat(gap) + right : undefined;
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
	const sep = theme.fg("borderMuted", " | ");
	const tail = [state.battery, state.clock].filter(Boolean).join(sep);
	return theme.fg("muted", text) + (tail ? sep + tail : "");
}

// Battery from sysfs, not upower: no daemon to depend on, and it works in a bare session.
// Charging/full get a distinct glyph; a low charge on battery turns the segment amber, then red.
const BAT_DIR = "/sys/class/power_supply/BAT0";

function batteryText(theme: any): string | undefined {
	try {
		const cap = parseInt(readFileSync(join(BAT_DIR, "capacity"), "utf8").trim(), 10);
		if (!Number.isFinite(cap)) return undefined;
		const status = readFileSync(join(BAT_DIR, "status"), "utf8").trim();
		// Icon only while charging: a glyph next to a plain percentage reads as a stray block in the
		// footer (seen 2026-10-23), and on battery the number plus colour is already unambiguous.
		const icon = status === "Charging" ? "⚡" : "";
		const color = status === "Discharging" && cap <= 15 ? "error" : status === "Discharging" && cap <= 30 ? "warning" : "muted";
		return theme.fg(color, icon ? `${icon}${cap}%` : `${cap}%`);
	} catch {
		return undefined;
	}
}

function clockText(theme: any): string | undefined {
	const d = new Date();
	return theme.fg("muted", `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
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
		const left = [head, state.ctx, state.tps, state.cache, state.spend].filter(Boolean).join(sep);

		const oneLine = model ? rightAlign(left, model, width) : visibleWidth(left) <= width ? left : undefined;
		if (oneLine) return [oneLine];

		// Narrow terminal: two lines, the session-hygiene half then the spend half, model
		// still pushed right.
		const line1 = [head, state.ctx, state.tps].filter(Boolean).join(sep);
		const line2Left = [state.cache, state.spend].filter(Boolean).join(sep);
		const line2 = (model && rightAlign(line2Left, model, width)) || `${line2Left}${sep}${model ?? ""}`;
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
			// Battery and clock are the only segments that drift on their own, so they are polled:
			// every 30s keeps the clock honest without a render loop.
			state.battery = batteryText(theme);
			state.clock = clockText(theme);
			const envTimer = setInterval(() => {
				state.battery = batteryText(theme);
				state.clock = clockText(theme);
				tui.requestRender();
			}, 30_000);
			return {
				dispose() {
					unsubscribe?.();
					clearInterval(envTimer);
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

	function refreshSpend(ctx: ExtensionContext) {
		state.spend = ctx.model?.provider === "opencode-go" ? goStatus(ctx) : undefined;
		requestRender?.();
	}

	// Cache-hit rate of the latest assistant response. Go prices a cache hit at a small
	// fraction of a miss (Flash ~50x, Pro ~30x), so this is the main lever on cost.
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
