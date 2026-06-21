# /finance checkpoint

Monthly tactical cadence — ~5 min. Routes surplus to the underweight bucket. Never sells.

## 1. Load context

Read `dashboard.md`, `log.md`, and `budget.md` in parallel.

## 2. Generated Knowledge — state the frame

Before drafting, state:
- **Target:** 4-3-2-1.
- **Current bucket totals** from `dashboard.md`, with gap to target in MU and %.
- **Which month** needs an entry (the one after the last entry in `log.md`).

## 3. Pre-fill the draft (PAL — math via Python)

Use the 6-bullet template. For any line that needs arithmetic — bucket gaps, surplus routing math, % deltas — run it through Python via Bash, not prose. Example:

```
python3 -c "
growth, core, bonds, gold = 95.2, 71.5, 48.0, 24.3
total = growth + core + bonds + gold
for name, val, tgt in [('Growth',growth,.4),('Core',core,.3),('Bonds',bonds,.2),('Gold',gold,.1)]:
    print(f'{name}: {val:.1f} MU ({val/total*100:.1f}%) vs {tgt*100:.0f}% target, gap {val-total*tgt:+.1f} MU')
"
```

Template:
- **Portfolio:** current snapshot from `dashboard.md`.
- **Cash in:** salary TBA (leave TBA unless user provides it).
- **Cash out:** estimate from known recurring (rent 1.5, tontine 5.0, subs ~1.0) + ask for actual living/travel expenses.
- **Actions:** any trades placed this month — ask if not clear.

### Give every dollar a job (YNAB-lite)

Before routing surplus, reconcile income against `budget.md`'s Monthly Jobs:
assign Cash in across fixed bills + sink funds + living, and **the residual is the
investable surplus** — never size the surplus first. If a category overspent,
note that it was covered from another (roll with the punches), don't silently
absorb it into the surplus. The residual then feeds the bucket-routing step below.
- **Next month:** suggest based on the most underweight bucket from step 2. Name the specific fund (consult `funds.md` for bucket → fund mapping and platform availability).
- **Notes:** context, one-offs, Korea session status if applicable.

## 4. Confirm and append

Show the draft. Ask the user to fill TBAs or correct anything. **Do not write until they confirm.** Once confirmed, append to `log.md` (newest entries at top, above the previous month).

Do not update `dashboard.md` during a checkpoint unless actual trades were made — the snapshot stays current to the last rebalance.
