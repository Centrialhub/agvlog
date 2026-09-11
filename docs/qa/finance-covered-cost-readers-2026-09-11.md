# Covered cost readers — 2026-09-11

Candidate 72723 is additive. No old expense, payable, payment, allocation, movement, bank entry, charge snapshot or payment event is rewritten.

## Verified locally

Two integrated PGlite tests passed (04:47:44, 4.28s):

- Real payment150 / original payable150 remains paid150; economic cost120; reserved150; separate pending recovery30. Expense/payment/link/movement JSON remains exact. Recorded cost list/summary return120; portfolio title still150/paid150/open0.
- Real driver advance150 and batch allocation150, no payable: economic cost120, custody30, uncovered0. Charge source_snapshot and allocation JSON preserved. Real settlement builder materializes120 once with reimbursable=false and settlement_credit_created=false; context target row needs_review=false, payable0/outstanding0.
- 31 additional real batch costs place the corrected expense outside page1. Both pages keep complete total15100 for32 rows; no browser subtotal.
- Pending index returns the full economic split and changes revision after a second regularization. Old revision page2 fails40001; missing revision fails22023. Foreign tenant and mixed-driver access fail42501; anon has no execute.
- Owner-only deliberate corruption of the journal source_snapshot produces verified=false and null monetary totals in coverage/index/cost list. Triggers were disabled ONLY for this adversarial corruption fixture; this is not evidence that application guards allow corruption. Normal positive tests use actual guards and commands.
- Real production schemas parse history, recorded costs, summary, portfolio, settlement context, coverage and pending index.

## Contract

allocated_cents is historical allocation. complement_cents is the historical registered complement/obligation nominal, NOT remaining cash to pay: the paid150/cost120 case keeps complement150. Explicit obligation_nominal_cents150 and uncovered_cents0 remove that ambiguity. coverage splits applied economic cost and residual pending disposition. No residual releases movement capacity. Unknown, missing or corrupt proof yields null money values, never a clamp or original-cost fallback.

Changed consumers: canonical_trip_costs, list_expenses, payable_effective_cost_evidence, payable_portfolio, settlement_expense_context. recorded_costs and recorded_cost_summary already call the effective-cost resolver and require no body replacement. New private coverage helpers and public authenticated get_finance_cost_dispositions use complete revision/pagination30. Current scope represents pending dispositions; later real-return overlay is a separate migration.

## Fixture and limits

Selected real financial chain through prepared-receipt predecessors40123/42754/44437, cost60519/60700/62534 and core72557. Payment fixture originally omitted the real baseline _recalc_payable_paid trigger; initial test correctly blocked approved/paid_amount0. Installed baseline recalc with the real03529 active_payable_payments transformation and original trigger before recording payment. No SQL guard was relaxed.

Settlement helper restores baseline schema columns/functions and134948 actual integration; it is not a complete operational/production schema. Storage metadata is a fixture; no new upload/provider/authentication or native concurrency run is claimed. No remote writes, deploy or commit occurred. Fingerprints and ACL/config are captured in finance-covered-cost-readers-catalog-2026-09-11.json for the separate public-boundary review.

## Final independent public-boundary and regression run

At04:50:36, three test files /11 tests passed in5.78s; ESLint exit0. Includes the7 previous effective-cost reader regressions plus2 covered-cost integration cases and2 independent public-boundary tests. Public preview/result production schemas passed, private evidence was absent, public correction/replay preserved the same result, and current-access revocation denied replay. A changed coverage-helper ACL prevented74203 promotion; restoring the reviewed ACL allowed promotion; anon/rawwriter remained denied.

Hashes in the JSON companion reflect the final local files, including the parent-added timeout-only header in72723. Public promotion was tested locally only; production application is owned by root.
