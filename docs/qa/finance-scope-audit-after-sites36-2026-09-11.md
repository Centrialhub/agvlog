# Scope audit after Sites36

Authoritative starting HEAD: 7d362321. Previous goal turn made progress: three production migrations and Sites36 were published. This audit does not declare the full objective achieved.

## Verified scope and limits

Root inspected financialRouteNavigation, financeAccessBoundary and financeActiveWorkspaceAccess tests before executing them with sidebarNavigation. Session99096 exited0:17 tests across4 files at09:38:51. These prove local route rendering, cached permission denial, driver redirect, mixed-role server-negative rendering and active-company SQL fixture checks. They do not prove authenticated hosted journeys or the full production RLS graph. The UI audit found17 financial destinations mapped to protected routes.

Retentions already present in NFS-e origin are handled in migration20260910005509 lines37–49: net/gross/withheld must agree. This does not provide a separate post-origin withholding component in settlement. Existing discounts/losses must not be mislabeled as withholding.

## Confirmed remaining implementation work

- Employee advances: PayrollAdvances offers Pagar and usePayroll updates status/paid_at directly. Migration20260911035125 explicitly rejects register_employee_advance mark_paid, so no creation bypass is established. Bank agent reproduces current direct UPDATE with active guards; backend agent prepares canonical outgoing evidence integration. UI lacks visible mutation errors and query loading/error handling.
- Expense batch: keyboard/duplication exists, spreadsheet paste required by plan286 does not. UI agent implementing TSV preview, exact cents, atomic validation and explicit append without automatic submission.
- Renegotiation: plan471 requires lineage without duplicated portfolio. Current forecast agenda changes expected date only. Candidate model documented separately; no renegotiation writer implemented or published.
- Global costs: recordedCostSummaryContract explicitly excludes legacy driver expenses and maintenance. Honest partial coverage does not fulfill complete company costs; deduplication required before including these sources. Pending-trip coverage indicator required by plan83 is absent.
- Multiple payable titles still require one association dialog per title; full bulk interaction remains pending.

## Rejected finding

The proposed N+1 legacy association issue was disproved by reading LegacyPayableAssociation.tsx:13. Its Workspace/query mounts only when open. No change is warranted for that claim.

## Acceptance remaining

Authenticated hosted end-to-end validation remains unproven. No infrastructure credential workaround, synthetic production records or new fiscal document was used in this audit. Publication approval persists, but publication alone is not acceptance. Original full plan and all multi-tenant constraints remain in scope.
