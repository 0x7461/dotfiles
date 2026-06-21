---
name: finance
description: Personal finance assistant — load portfolio context, run monthly checkpoints, or run rebalance math. Use /finance, /finance checkpoint, or /finance rebalance.
user-invocable: true
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash
---

Interface with the personal finance system at `~/obsidian-vault/finance/`.

**Operating principle.** This skill is a second pair of eyes on a pre-agreed strategy (4-3-2-1, fund roster in `funds.md`). It drafts work — entries, allocations, trade suggestions — and waits for sign-off before writing anything to `log.md` or `dashboard.md`. It does not place trades (you do that yourself in the fund platforms). Within that frame, *actively* suggest which bucket to feed and which fund within it; flag obvious tax/timing/channel concerns; push back when a proposed action drifts from strategy.

## Usage

```
/finance              — load context, show current state, suggest next action
/finance checkpoint   — draft a new monthly log entry  (see CHECKPOINT.md)
/finance rebalance    — run rebalance math for a formal window  (see REBALANCE.md)
```

---

## Default: `/finance`

### 1. Load context (always do this first)

Read in parallel:
```
~/obsidian-vault/finance/dashboard.md
~/obsidian-vault/finance/log.md
~/obsidian-vault/finance/strategy.md
```

### 2. Generated Knowledge — state the frame before reasoning

Before suggesting anything, state out loud (one compact block):
- **Target:** 4-3-2-1 (Growth 40 / Core 30 / Bonds 20 / Gold 10).
- **Current totals** per bucket from `dashboard.md`, with gap to target in MU and %.
- **Cadence position:** which monthly slot is open; is a formal window (June/December) approaching.

This is the working set. Suggestions in step 3 must reference these numbers, not vibes.

### 3. Suggest next action

Pick the most useful next step:
- "Monthly log entry for [month] not yet written — run `/finance checkpoint`."
- "June formal review is due — run `/finance rebalance`."
- "MoMo channel issue pending — check if VCBF buys are working."
- "Nothing urgent — Growth gap of X MU to close this month via MGF."

---

## File map

| File | Purpose | Updated when |
|---|---|---|
| `dashboard.md` | Current portfolio snapshot | After rebalances |
| `log.md` | Monthly entries (6-bullet, append) | Monthly checkpoint |
| `strategy.md` | Policy — targets, rules, cadence | Strategy changes only |
| `budget.md` | Monthly "every dollar a job" plan (YNAB-lite) | Income or fixed-cost changes |
| `funds.md` | Fund directory — mandate, bucket, platform | Annual or when fund changes |
| `accounts.md` | Non-fund accounts (cash, EF, FX) | When accounts change |
| `logs/` | Detailed session logs (Korea assignments, etc.) | Per event |

## Notes

- **Unit:** MU = Million VND.
- **Target:** 4-3-2-1 (Growth 40% / Core 30% / Bonds 20% / Gold 10%).
- **Monthly cadence:** light — 5 min, routes surplus only, never sells.
- **Formal cadence:** June + December — strategy review + full rebalance math.
- **PAL rule.** All arithmetic — bucket totals, gaps, allocation splits, deployment math — runs through Python (`python3 -c '...'` via Bash), never prose. Prose math has been wrong before; Python is the source of truth.
- **Sign-off gate.** Never edit `log.md`, `dashboard.md`, or `budget.md` until the user confirms the draft. Show the draft, take corrections, then write.
- **Budget pass.** The monthly checkpoint reconciles income against `budget.md`'s jobs; investable surplus is the residual after jobs are funded (YNAB-lite, see CHECKPOINT.md). Light by design — no per-transaction categories.
- **Don't read `logs/` files** unless the user asks about a specific past session.
- **Never display** raw credentials from `accounts.md` or any file with API keys — summarize balances only.
- **HTML rebalance view:** during `/finance rebalance`, offer to generate a single HTML file with allocation sliders and a "copy as rebalance instruction" button — useful for interactive tuning before confirming. Terminal artifact only; don't replace `dashboard.md`.
