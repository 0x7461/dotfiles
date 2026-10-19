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
//   dir (branch) [changed] │ ctx <tokens> (<%>) <zone> │ <tps> │ CH<pct> │ <spend>   …   model • thinking
//
// The model is right-aligned to the terminal edge, as the built-in footer did.
//
// It carries over the built-in footer's cwd, branch, context %, cache-hit, model and
// thinking level. It drops the ↑input ↓output RcacheRead WcacheWrite totals (rarely
// actionable) and pi's session cost — the spend segment below prices the paid host itself.
//
// The spend segment covers the one paid host (ithaca PLAN, Decisions): opencode-go — a flat
// subscription with per-model capped allowances. Go prices usage at the same per-token rates
// pi records in `usage.cost`, so summing those approximates Go's meter against the active
// model's monthly allowance. The direct lane is closed (account deleted, 2026-10-19).
// The figure covers this machine's pi sessions only.
const HOME = homedir();
const SESSIONS_DIR = join(HOME, ".pi", "agent", "sessions");
const SPEED_THROTTLE_MS = 250;

// OpenCode Go per-model monthly allowances, $/mo (opencode.ai/docs/go, 2026-10-19). Each
// model is metered independently; the 5h window is 20% of the monthly limit, the weekly 50%.
// Go prices peak/off-peak separately but pi records `usage.cost` flat, so this sums pi's
// meter and compares it to the allowance — an approximation, not Go's ground truth.
const GO_MONTHLY_USD: Record<string, number> = {
	"deepseek-v4-pro": 15,
	"deepseek-v4.1-flash": 80,
	"deepseek-v4-flash": 80, // legacy id; billed as v4.1
};
// Unknown model: assume the smallest common allowance so the meter errs toward warn.
const GO_MONTHLY_USD_DEFAULT = 15;

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

function goStatus(ctx: ExtensionContext): string {
	const model = ctx.model?.id?.replace(/^models\//, "");
	const capUsd = model ? (GO_MONTHLY_USD[model] ?? GO_MONTHLY_USD_DEFAULT) : GO_MONTHLY_USD_DEFAULT;
	const now = Date.now();
	// Go meters each model's allowance independently, so sum only the active model's usage.
	const spend = (since: number) =>
		assistantMessagesSince(since, "opencode-go")
			.filter((m) => m.model === model)
			.reduce((usd, m) => usd + (m.usage.cost?.total ?? 0), 0);
	const meter = (label: string, usd: number, cap: number) => {
		const pct = Math.round((usd / cap) * 100);
		return heat(ctx, pct, `${label} ${pct}%`);
	};
	const meters = [
		meter("5h", spend(now - 5 * 3600_000), capUsd * 0.2),
		meter("7d", spend(now - 7 * 86400_000), capUsd * 0.5),
		meter("month", spend(monthStart(now)), capUsd),
	];
	return `go ${meters.join(" · ")}`;
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
