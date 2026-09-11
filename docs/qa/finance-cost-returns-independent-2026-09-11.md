# Independent recorded-return verification — 2026-09-11

Core74603 SHA dff497b45ea51da7287c628da7208630bc6456e6b617ff5f9f49319bbe5675b4. No production writes were performed by this agent.

## PostgreSQL17.11 concurrency

Five PASS, process exit0, disposable server stopped. Exact log: finance-cost-returns-native-2026-09-11.log.

1. Real canonical receive holds the shared input; waiting return acquires the finance lock after commit and rejects its stale revision40001.
2. Return holds the shared input; waiting canonical receive rejects shared capacity, with no extra receipt/link.
3. Real legacy association holds the shared input; waiting return rejects revised evidence40001.
4. Return holds the shared input; waiting legacy association rejects capacity.
5. A row-first lock on incoming finance_movements causes return NOWAIT40001 instead of deadlock.

Final state verified: only2 returns totaling2000; outgoing historical reserve15000; historical residual3000; pending open1000. No return added cash or released outgoing capacity. Existing receive/legacy paths and the return use the same tenant:finance lock. The shared145616 check reads the updated receipt_movement_used_cents; both orders were observed blocked through pg_blocking_pids by the existing runner, then rechecked after commit.

## PGlite independent evidence

Three independent cases plus5 author cases passed in5.34s at05:10:49; lint0. Historical legacy receipt adoption was tested in both orders: full return3000 blocks legacy1000; legacy1000 limits return to2000. Owner-only corrupted return source_snapshot invalidates effective cost (now null), pending index monetary totals and the production cost-origin schema. This exposed the initial missing-null bug, corrected by the core author before freeze.

The historical receipt fixture disables user triggers only while inserting an explicitly pre-cutoff legacy receipt, flushes constraints, then restores triggers before association/return. It is not evidence that current application writers may insert untracked payments. Positive new movements/payments/regularization/returns use real commands and guards.

## Harness scope

The helper runs the same selected financial TypeScript fixture through persistent psql transport; esbuild only replaces the PGlite client constructor with this real SQL transport. No PostgreSQL functions are replaced by always-success stubs. Fixture includes cost/core/readers/public74203, actual145616 capacity and legacy association functions/triggers,185517 origin proof, and74603. It retains the preexisting selected-schema limits, including synthetic Storage/Auth identities and omitted unrelated foreign-key graph; it is not full production Supabase.

First native attempt failed solely because json_agg emits multiline output; the transport initially parsed only the last line. Corrected transport reads the complete JSON. Server shutdown was verified before repeating. SQL product unchanged. After successful run, three unused helper functions were removed to satisfy lint; exercised fixture and native case bodies were unchanged.

## Public80545 read-only review

All10 function body pins match the frozen catalog with security-definer, volatility and empty search_path. Public invoker wrappers delegate to private gated functions, preview checks tenant/actor/disposition/incoming/amount and strips _evidence; raw writer and anon remain ungranted. Reported one concrete preflight gap: trigger event/timing bitmask tgtype was not checked despite checking name/function/deferred flags. Root corrected the guard to require exact tgtype7 (BEFORE INSERT),5 (AFTER INSERT),27 (BEFORE UPDATE/DELETE); final read-only inspection confirmed all five mappings and the subsequent tgqual IS NULL / tgnargs=0 checks against conditional or argument-altered triggers. No rerun of already-passed native scenarios is required for that independent promotion guard.
