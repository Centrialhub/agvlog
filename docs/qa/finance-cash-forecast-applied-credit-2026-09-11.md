# Applied credit in cash forecast — local integration (2026-09-11)

Candidate02519 is implemented and independently reviewed. It is not applied or published. Validated against frozen01312 SHA298e3ae217acf80e32439e097c0f202d0d0be425b14fb8b54b116d3dbd81a2ac, with four exact core function fingerprints checked by02519. Promotion awaits the catalog and UI release bundle.

## Monetary behavior

The existing before-agenda collector keeps its OID and source scope. Receivable fulfilled_cents uses cash_received_cents; reserved_credit_cents uses credit_applied_cents. Their sum equals settlement; remaining expected incoming is nominal minus both once. Credit evidence keeps its existing DTO but amount_cents means available balance, which was already the full balance before applications existed. The global unassigned total now sums available balance, not original credit amount. Fully allocated credit creates no unassigned-credit issue. Unverified source leaves null amounts and incomplete projections.

The underlying immutable credit proof remains separate from the forecast wrapper to avoid recursion. The wrapper requires company access, verifies returned tenant/credit/payer identities, and has no public grants. Source revisions include current position evidence; the agenda can diagnose outdated expectations. Existing saved forecast JSON is never rewritten.

## Executed workflow

cashForecastAppliedCredit.test.ts: one combined SQL/TypeScript workflow passed at07:47:44, including:

- Actual receipt600 against original debt1000; real release_cancelled_receipts creates the cancellation credit from the recorded payment and existing cancelled fiscal facts.
- Apply400 to a valid500 title: cash0, linkedcredit400, forecast incoming100, availablecredit200.
- Apply200 to a second200 title: available0, no unassigned-credit issue, incoming still100.
- Receive the actual remaining100 of the first title: cash100, linkedcredit400, expected incoming0; exactly one new real payment/bank row.
- Release400 from the first title: available400, incoming400 (cash100 still received), no new payment or bank transaction.
- Preserved snapshot before application remains byte-identical; bank records and payment rows stay byte-identical across credit application/release; only the actual100 receipt adds rows.
- SQL projector result equals TypeScript projector result.
- Mark origin fiscal state review: credit/affected-origin amounts become null and confirmed forecast incomplete; rollback restores the source.

Fixture uses the full existing forecast/agenda chain plus captured production financial functions, original invoice-command DDL and its required composite identity keys, and original fiscal-issue function. The collector fixture lacked the existing receivable cte_document_id column, added for the real predicate. Existing fiscal facts are isolated fixture data; no provider or issuer was called. This does not substitute for separate worker/invoice cancellation and native concurrency tests. No successful stub or disabled guard was introduced. The test is not authenticated hosted browser QA.

Source labels distinguish linked credit from available credit. Lint passed for the three modified TS/TSX files. Current implementation and test remain candidates pending the final core and public boundary.

## Fully settled agenda regression

A stale manually scheduled date previously left a blocking forecast issue after complete settlement. The combined workflow reproduced the failure before the fix.02519 preserves stale agenda and history, but omits the stale-date issue only for a verified origin with no remaining balance. Releasing credit restores positive balance and the issue, requiring a fresh date review. Independent native_finance_links review accepted this change without an additional defect. No existing snapshot is rewritten.

Final regression: five files /16tests passed07:52:43 (applied-credit, agenda, agenda current-cost, agenda panel and collector credit). Root three-file lint exited0.
