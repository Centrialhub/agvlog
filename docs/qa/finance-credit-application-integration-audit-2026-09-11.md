# Credit application integration audit — 2026-09-11

Production definitions were read from qcvnsdrbcchaxvawcngk and preserved in finance-credit-application-predecessors-2026-09-11.json. This is an implementation dependency audit, not a completed feature.

## Confirmed missing behavior

finance_customer_credits preserves money received against a cancelled fiscal title. There is no command to apply that credit to a new valid title. The current collector assigns reserved_credit_cents=0 and sums all valid customer credits as unassigned. The UI can show credit creation but cannot consume it.

A new allocation cannot be inserted into receivables_payments: that ledger requires each row to own a distinct bank transaction whose entire value equals the payment. Reusing the original credit payment would violate this evidence and could double count cash.

## Required integration

Use an immutable, tenant-scoped application journal linked to the original credit, same payer and destination receivable, with actor, reason, request identity, original-source evidence and compensating release events. Partial and multiple applications consume shared capacity. A release changes allocation only; it never claims cash was returned. A real refund must consume the same credit capacity and reference a separately recorded outgoing movement.

The final implementation must expose cash received, credit applied and outstanding separately. Existing received_amount and status projections, invoice/closing lifecycle, receivable context and temporal history must remain consistent. Merely patching the context open_cents is insufficient: _guard_receivable_ledger and _recalc_receivable_received currently derive only cash, and _invoice_lifecycle_snapshot compares that shared ledger with invoice and closing projections.

All mutation routes that consume a receivable balance must share fiscal-to-finance serialization and current revision checks. Credit application versus cash receipt, fiscal cancellation, release, second application and refund must be exercised in both lock orders. Revoked or mixed driver membership must fail after waiting and on request replay.

Forecast must subtract applied/reserved credit once from the destination expected incoming amount and remove that same amount from unassigned credit. Original bank cash and period closures must remain byte-for-byte unchanged. A cancelled destination must release its credit application by a compensating event instead of creating another customer credit for the same money.

## Acceptance examples

- Cancelled original 1000, real receipt 600: original open 0, available payer credit 600, bank entry unchanged.
- Apply 400 to valid title 500 of the same payer: destination cash_received 0, credit_applied 400, open 100; credit available 200; new cash entries 0.
- Then receive real 100: destination open 0; only that 100 is new cash. Existing 600 remains represented once.
- Apply to another payer/company, cancelled or fiscal-pending destination, stale revision or insufficient credit: reject atomically.
- Release the 400 allocation: original application stays visible; destination opens 400; payer credit returns to 600; bank cash unchanged.
- Cancel a credited destination: same compensating release, no duplicate new credit, no resurrection of the cancelled fiscal document.
- Multiple target titles, multiple source credits, partial use and concurrent consumption must preserve exact cent totals.

Production signatures at audit: ledger 351d7b05301ec509747944c68ea6c49e; guard 33abeae97a75989a43549b7a67a83720; recalc 85aacc9b3818bfe4d5f6f06ef0e3bb95; snapshot 8593db406c00779581a34e2038cb5d7f. Re-read before any production patch, as other financial work continues.
