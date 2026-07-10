# /finance rebalance

Formal semi-annual review (June + December). Strategic, not just cash routing.

## 1. Load full context

Read in parallel:
```
~/obsidian-vault/finance/dashboard.md
~/obsidian-vault/finance/strategy.md
~/obsidian-vault/finance/funds.md
~/obsidian-vault/finance/log.md
```

## 2. Generated Knowledge — state the frame before any reasoning

State out loud (one compact block):
- **Target:** 4-3-2-1.
- **Current bucket totals** from `dashboard.md`, gap to target in MU and %.
- **Fund roster** from `funds.md`: which fund maps to which bucket, with any platform notes (blocked channels, fee changes).
- **Last formal review:** date + headline action, from `log.md`.

All subsequent suggestions must reference these numbers.

## 3. Strategic review questions

Before math, ask:
- "Has the FIRE timeline or life situation changed? Still comfortable with 4-3-2-1?"
- "Any fund concerns — manager change, mandate drift, expense ratio creep?"
- "Any platform/channel issues to address (MoMo, etc.)?"

If all clear, proceed. If something changed, discuss before crunching numbers.

## 4. Get current numbers

Ask for:
- Current fund values (NAV × units for each fund).
- Cash available to deploy this window.

## 5. Run the math (PAL — Python only)

**All arithmetic runs through Python via Bash.** No prose math. Use a single block:

```
python3 -c "
funds = {
    # name: (value_MU, bucket)
    'MGF': (52.3, 'Growth'),
    'VESAF': (43.8, 'Growth'),
    'VCBF-BCF': (71.5, 'Core'),
    # ...
}
buckets = {'Growth':.4,'Core':.3,'Bonds':.2,'Gold':.1}
totals = {b:0 for b in buckets}
for v,b in funds.values(): totals[b] += v
port = sum(totals.values())
cash = 10.0  # user-provided
print(f'Portfolio: {port:.1f} MU + cash {cash:.1f} = {port+cash:.1f} MU')
for b, tgt in buckets.items():
    cur, want = totals[b], (port+cash)*tgt
    print(f'{b}: {cur:.1f} ({cur/port*100:.1f}%) → target {want:.1f}, gap {want-cur:+.1f} MU')
"
```

For each bucket: show gap in MU and %; propose how to close it (cash deployment, no sales unless extreme drift); respect channel constraints from `funds.md`; offer trade-off options where the split is non-obvious.

Actively recommend specific funds within each bucket — that's the point of the second pair of eyes. Flag obvious problems (concentrated in one fund, blocked channel, tax timing) before the user has to ask.

## 6. Confirm and write

Show the proposed trades. **Wait for user confirmation.** Once confirmed:
- Update `dashboard.md` with new portfolio snapshot and actions taken.
- Append a `log.md` entry for the rebalance month.
- Note any deferred actions (blocked channels, remaining gaps, next-window priority).
