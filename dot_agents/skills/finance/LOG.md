# Procedure: log

Write or finalize monthly entries in `log.md`. Handles one month, a backlog of
several, and clearing `⚠ PROVISIONAL` markers. Append-only, newest at top.

## 1. Establish what is open

From the frame, list every month that needs work, oldest first:
- **Missing** — no entry at all.
- **Provisional** — header carries `⚠ PROVISIONAL`, past its finalize-by date.

Work oldest-first. A late backlog is normal — three weeks late has happened twice.
Don't editorialize about the delay; just clear it.

## 2. Collect the numbers

Ask for what only the user has, in one batch rather than one question at a time:

- **Total spending for the month** — they read it off bank account history.
- **Salary**, and whether any part is a one-off (travel allowance, bonus).
- **Fund values** — NAV × units per fund, plus gold (GU × current buy-back price,
  which is a retail price, not SJC).
- **Trades placed**, with order dates.
- **Receivables** that moved.

## 3. Separate own burn from fronted money

Bank outflows are not burn. Subtract what gets refunded — rent and utilities
fronted for the whole house — and say both numbers. Only own burn is comparable
to the budget ceiling.

Per `strategy.md`: undated loans are expensed at issue, not booked as receivables.

## 4. Draft the 6-bullet entry

Math via Python (PAL rule). Template:

- **Portfolio:** total MU, bucket split, gap to 4-3-2-1, and what moved it (MTM vs trades).
- **Cash in:** each inflow, with the recurring base separated from one-offs.
- **Cash out:** own burn vs budget, with the drivers named; dated commitments still due.
- **Actions:** trades with order dates and the reasoning, including what deliberately got nothing.
- **Next month:** known one-offs and any budget line that changes.
- **Notes:** corrections, accounting decisions, receivable movements, things to watch.

Unknowns stay `[TBA]`. If the month is not closed, stub it and set the header:
`⚠ PROVISIONAL — stubbed YYYY-MM-DD · finalize by YYYY-MM-DD (what's pending)`

## 5. Confirm, then write

Show the draft. Take corrections. **Do not write until confirmed.** Append above
the previous month. Do not touch `dashboard.md` unless trades actually settled.

## Chains into

- Spend that has no budget line, or a category over again → `BUDGET.md`
- Cash sitting idle after the entry closes → `DEPLOY.md`
