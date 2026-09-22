# Procedure: strategy

Targets, guardrails, fund roster, channels. Runs when something trips it — a
breach, a mandate change, a channel failure — or when the user wants the periodic
look.

## Cadence

Formal review windows are **June and December**. Bare `/finance` surfaces this as
a one-line reminder and nothing more.

It is a nudge, not a gate: the June 2026 review ran about seven weeks late after
three deferrals, and nothing broke. Deployment does not wait for a window — the
math runs whenever there is cash. Don't hold work back for a date, and don't
manufacture a review because the calendar turned.

## 1. The review questions

- Has the FIRE timeline or life situation changed? Still comfortable with 4-3-2-1?
- Any fund concerns — manager change, mandate drift, expense ratio creep?
- Any platform or channel issues (MoMo, VCBF, Fmarket)?

If all clear, say so in a line and stop. A clean review is a valid outcome.

## 2. Guardrails

Every rule in `strategy.md` gets checked against the frame, with its margin:

- **Manager concentration ≤40%** — one manager's share of the portfolio.
- **Undated loans expensed at issue** — not carried as receivables.

A breach is not automatically actionable. Say how large it is, what closing it
would cost, and whether the largest available step even fixes it — a breach that
needs ~82 MU to clear is a multi-session problem, not this session's.

When a new rule is proposed, write it into `strategy.md` with the date and the
situation that produced it. A guardrail without its reason gets argued with later.

## 3. Fund research

When a bucket needs a new candidate, or a fund's mandate is in question:

- Work from the current factsheet. The user will supply URLs or files; ask rather
  than guess at performance figures.
- Record in `funds.md`: mandate, bucket, manager, platform availability, fee, and
  the date of the factsheet used.
- Mark a fund `candidate` until there is an account and a working channel.
- Check manager concentration before recommending — a good fund under a manager
  already at the cap is not buyable.

## 4. Confirm, then write

Show what changes in `strategy.md` or `funds.md` before writing. Roster and
guardrail changes are policy, so they carry the same sign-off gate as everything else.

## Chains into

- A guardrail change that reallocates money → `DEPLOY.md`
- A rule that changes how burn or income is counted → `BUDGET.md`
