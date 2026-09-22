# Procedure: budget

Fix the plan itself — category sizes, missing lines, accounting rules, EF target.
This is the procedure that had no home before: it surfaces mid-session, from a log
pass finding spend that no budget line covers.

## 1. Reconcile income against jobs (YNAB-lite)

Assign the recurring income base across fixed bills, sink funds, and living.
**The residual is the investable surplus — never size the surplus first.**

If a category overspent, note which line covered it (roll with the punches).
Don't silently absorb an overrun into the surplus; that is how an overrun hides.

Light by design. No per-transaction categories — the user will stop using a tool
that demands them.

## 2. Find the lines that don't exist

When actual burn exceeds budget, the first question is not "which line overran"
but **"which spend has no line at all."** Four such categories were found in one
2026-09-18 pass, worth 1.13 MU/month.

Probe for: clothing, gifts (birthdays cluster), charity on an annual cycle,
Tết and other lunar-calendar lumps, pet vet bills, one-off capital purchases.

Size an annual or seasonal cost at its observed floor, monthly, and say it is a
floor. Mark it `⚠ estimate` until two or three months of actuals exist.

## 3. Distinguish capital from lifestyle creep

A one-off purchase (e-bike, driving lessons, a laptop) is capital: exclude it from
the burn baseline so it doesn't corrupt the trend. Any *recurring* tail it creates
(a battery lease, insurance) does get its own line.

## 4. Changing an accounting rule

When a rule is wrong, changing it moves numbers across the whole history — say by
how much before writing. The 2026-09-18 tontine fix (contributions are burn,
payouts are income) moved the budgeted savings rate 41.07% → 50.005%.

Rules to keep consistent:
- **Recurring base, not gross.** One-offs stay out of the denominator.
- **Burn ceilings and savings rate must use the same definition of income.** They
  disagreed once and nobody noticed for a month.
- **Undated loans are expensed at issue** (`strategy.md`), not carried as receivables.

## 5. Measure before cutting

When a line looks too big, check whether it has ever been measured. Two or three
months of actuals first — the user has chosen this repeatedly over cutting blind,
and has been right to.

## 6. EF sizing

Target = months of cover × the *emergency* burn, which is lower than the budgeted
burn (pausable categories drop out). State both, and which months figure you used.

## 7. Confirm, then write

Show the revised table with old → new per changed line, and the net monthly delta.
**Wait for confirmation**, then write `budget.md` — and `strategy.md` if a rule changed.

## Chains into

- A rule change that needs a guardrail → `STRATEGY.md`
- A freed-up or newly-found surplus → `DEPLOY.md`
