# Receivable adjustment public boundary candidate — 2026-09-11

CLI-created migration20260911121356_finance_receivable_adjustment_public_catalog.sql. Public SQL INVOKER endpoints preview_finance_receivable_adjustment, record_finance_receivable_adjustment, get_finance_receivable_adjustments dispatch through authenticated private DEFINER wrappers with empty search_path and explicit require_access. Raw core context/writer/history remain owner-only. Preview checks returned identities and manager/eligible/execute permissions before can_execute. History exposes the existing safe core DTO. Journal RLS/private ACL and five preserve/guard/deferred/recalc/sync triggers checked before exposing.

Root test09:16:34 passed with actual SET LOCAL ROLE authenticated: preview/parser, write/result parser, exact idempotent replay, history/parser, other-company denial, direct raw writer denial, mixed-driver replay denial, constraint flush. Focused lint exited0. No production changes from this candidate.

Pending final core freeze: add exact core fingerprints (currently metadata/trigger/journal preflight only), full final rerun, typecheck/build and publication together with all new consumers. Do not deploy this candidate alone. Core15046 is still being reviewed for temporal and fiscal scenarios.
## Final release supersedes candidate status
All 23 exact core fingerprints were pinned. Final root 9 tests passed at 09:28:24. Application typecheck56950 and build11334 exited0. Three migrations applied successfully and catalog verified in finance-adjustment-production-release-2026-09-11.md. Sites36 succeeded at 2026-09-11T12:34:00.750164Z. Authenticated hosted end-to-end acceptance remains unproven.
