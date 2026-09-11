# Covered unloading cost regularization — local UI

Separate contract and workflow preserve historical payable nominal/paid values, bank movement and reserved capacity. The proposal names every source and responsible identity; applied cents are explicit, using exact decimal-to-BigInt conversion. The preview separates current/proposed cost, gross reservation, driver custody and payment recovery. No return/offset action is offered.

The new durable outbox preserves actor/tenant/charge/expense/nullable payable, proposal, revision, reason and captured expected effects. Unknown results keep the same request. First definitive rejection may clear it; rejection after uncertainty does not. Response IDs, disposition count and effects must match before acknowledgement. Confirmed success is terminal even when refresh fails.

The contextual entry is restricted to unloading rows for owner/admin; the financial access boundary and backend capability still govern execution. There is no entry for ordinary expenses. Sources and preview use separate queries; changes to source revision/application clear or refetch eligibility. Refetch/errors hide prior preview values.

The global dispositions panel lists all regularized expenses, including driver custody without a payable, using server totals and pagination30. Revision changes restart page1 with a new epoch; no cached page1 reuse, even with infinite cache freshness. Unknown coverage remains visible and totals indeterminate. Readers expose original allocation separately from economic application; complement uses explicit server coverage, never corrected120 minus original150. Historical title150 remains150 after a recovery30.

Targeted verification is recorded in unloading-cost-regularization-integrated-ui-2026-09-11.log. Native/bank separately own real SQL and public-boundary tests. This task did not execute global TSC, deploy, commit or database writes. Exact UI/source allowlist is finance-unloading-covered-cost-ui-allowlist-2026-09-11.json.

Final local result: 53 tests passed in 12 files, process25291 exit0. Focused ESLint completed without diagnostics. This run includes the final source-revision query key and eligible-disposition invariants.
