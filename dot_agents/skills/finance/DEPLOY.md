# Procedure: deploy

Put available cash to work. Runs whenever there is cash to spare — not on a
calendar. Never sells to rebalance; drift closes by feeding the underweight leg.

## 1. Find the deployable amount — before any allocation math

Cash on hand is not deployable cash. Work down:

```
cash on hand
  − dated commitments before the next salary   (tontine round, rent, known bills)
  − living expenses until the next salary       (ask; don't infer)
  − EF top-up, if one is planned
  = deployable
```

State each subtraction with its source, and mark it **rule** (which file says so)
or **judgment** (yours). The user has asked "is that the rule or your judgment?" —
answer it before they have to.

Then offer the number as a *ceiling*, not a target. The user may deliberately
deploy more and run thin; that is their call to make, and they have made it.

## 2. Compute the split — Python only

```
python3 -c "
funds = {'MGF': (106.1,'Growth'), 'DCDS': (107.9,'Growth'),
          'VEOF': (63.4,'Core'),  'BCF': (70.1,'Core'),
          'DCBF': (118.7,'Bonds'), 'DCDE': (24.7,'Growth'),
          'Gold': (54.8,'Gold')}
targets = {'Growth':.4,'Core':.3,'Bonds':.2,'Gold':.1}
cash = 50.0
totals = {b:0.0 for b in targets}
for v,b in funds.values(): totals[b] += v
port = sum(totals.values())
print(f'Portfolio {port:.2f} + cash {cash:.2f} = {port+cash:.2f} MU')
for b,t in targets.items():
    cur, want = totals[b], (port+cash)*t
    print(f'{b}: {cur:.2f} ({cur/port*100:.2f}%) -> target {want:.2f}, gap {want-cur:+.2f} MU')
"
```

## 3. Apply the constraints that override the raw gap

Check each and say which one bound:

- **Manager concentration ≤40%** (`strategy.md`). This can force money away from
  the most underweight bucket. When it conflicts with 4-3-2-1, say which won and
  what it cost.
- **Channel availability** (`funds.md`) — a bucket reachable through only one
  manager may be unfeedable without breaching the concentration rule.
- **Indivisible units** — gold trades in whole GU (~13–15 MU retail). A gap
  smaller than one unit is cheaper left open than overshot.
- **Within-bucket choice** — name the specific fund and why. A split that fixes
  concentration identically may still create a second concentration problem.

## 4. Confirm, then write

Show the proposed orders. **Wait for confirmation.** Once the user places them:

- Note them in the current `log.md` entry as ordered, settlement pending.
- Update `dashboard.md` only once settlement is confirmed.
- Record what deliberately got nothing, and the remaining gap for next time.

Offer a single-file HTML view with allocation sliders when the split is worth
tuning interactively. Terminal artifact only — it never replaces `dashboard.md`.

## Chains into

- A guardrail that cannot be satisfied at this size → `STRATEGY.md`
- Living-expense estimate that contradicts the budget → `BUDGET.md`
