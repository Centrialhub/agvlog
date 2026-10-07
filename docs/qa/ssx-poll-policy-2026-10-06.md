# SSX polling controls — independent local candidate

Base: `61adbbb997667396541244da147b224defb22e94`, tree `328f33f69c352720574b24deebaa9d19bde7faaf`. Task `ssx-poll-policy-20261006`, owner `CodexSSX`, created with coordinator `fork-review` from the frozen `operational-chat-access-20261006` candidate. No source from dirty legacy trees. The final SHA/tree and hashes are in the task-2 handoff manifest.

This candidate corrects SSX polling controls. It is independent of freight/fiscal, driver, SQL and publication work. No shared replica, live SSX account, login, command, remote migration or publication was used. External SSX budget remains 3/3 consumed from the earlier bounded read; tests use synthetic fixtures and intercepted fetch. Coordinator checks make their ordinary read-only published-pin verification.

## Confirmed behavior and change

The poll source and shared utilities have identical Git blobs in c461 and61ad. A new real-handler suite run against the original61ad poll source failed15 of19 cases as expected, then restored the exact candidate bytes in `finally`. The failure log and hashes remain in task-2.

- JSON booleans are strict at both `agvlog-pipeline-run` and `ssx-poll-positions`. Omitted flags are false; strings, numbers, null and other non-booleans return400. Lookback must be a positive finite numeric number of minutes representable as a Date window; supplied invalid values do not silently use another window.
- Manual/debug selection respects active account cooldown and unit backoff. The longest valid account/settings deadline wins. An account cooldown prevents provider-unit reads and provider requests; a unit backoff skips its selected-unit request.
- Both broadband and per-unit429 paths propagate the parsed `Retry-After` into account cooldown and unit backoff, with the existing120-second floor. Missing/invalid/shorter retry values retain that conservative floor. Memo, scout and discovery abort paths preserve the parsed wait and stop the batch. A returned cooldown receipt must be valid, tenant/account scoped and at least as late as requested.
- Explicit lookback wins with either a first or existing cursor. Manual polling no longer silently expands an existing cursor to24hours. Default/configured incremental polling, two-minute overlap, binding-start clamp and explicit rediscovery remain. First poll still uses configured `initial_poll_window_minutes`, or the previous7-day default when omitted. This historical default was not changed by a new business assumption.
- Per-unit requests now include both `>= start` and `< poll-start-now` on their selected time property, in addition to the unit filter. Future cursor/binding starts yield no elapsed window and skip provider I/O. `force_rediscovery` can reset discovery but cannot expand the requested time window or bypass throttling. FleetMap's explicit43200-minute/30-day request remains valid; no new arbitrary history-days ceiling was introduced.

## Local validation

-25 SSX test files:243PASS, including55 new policy/handler cases and6 additional pipeline negatives. Tests import the real Edge handlers and, for429 propagation, the real `ssxPost`, while fetch and client storage are synthetic/intercepted.
- Script pipeline:179PASS,1 existing Windows skip (`Linux log directory permissions must be private`); no new skip or reduced assertion.
- Typecheck, lint errors, critical-type lint, structural quality, Edge syntax and production build/artifact checks are recorded individually in the handoff manifest. A gate is PASS only after its process exits successfully. Quality baseline stayed99/113 explicit-any warnings, with no new files above500lines and no increased thresholds.
- A separate own in-memory PGlite fixture executes the existing SQL function:120,600 and3600seconds accepted;3601 rejected with `22023/ssx_account_cooldown_invalid` and unchanged account state. This is real SQL on a partial synthetic fixture, not the native review database or proof of its full schema/RLS/transport.

## Blocking dependency and business boundary

**Not publication-approved / full A7 not homologated.** The current `record_ssx_account_cooldown_v1` SQL rejects deadlines beyond one hour. The shared HTTP parser also has a pre-existing24-hour cap. This candidate respects parsed Retry-After within the existing one-hour persistence contract; longer responses cause a persistence failure rather than a silent shorter wait. They do not establish a durable account wait, so a later run may call the provider again. Do not treat that case as solved or publish based only on mocked successful receipts.

Integration must decide the supported provider wait contract and prepare a guarded additive SQL change/review if waits above one hour must be durable. Do not simply clamp the provider wait downward or weaken the temporal guard. No SQL was changed here. Actual allowed history days and minimum query cadence belong to SSX account configuration; no additional arbitrary limit was inferred from the docs. Changing default first/manual history or the existing120-second floor is a separate business decision.

The per-unit500-record saturation/completeness strategy is unchanged; native A7 must still assess this separately. A bounded request does not establish provider filtering/completeness.

## Integration and native verification

1. Take only the seven owned files via the independent local commit; reconcile with the parent's combined candidate and validate its final SHA. Do not enqueue this review fork directly or publish a task branch.
2. Reviewer uses its exclusive database/Edge/UI stack with only own QA UUIDs and valid synthetic bindings. Intercept provider calls with an egress-denying fixture. No real Login, fiscal document action or new SSX call is authorized by these tests.
3. Verify400 for coerced flags at both entry points; no nested provider call/write. Verify active account cooldown blocks both manual and automatic callers, and selected-unit backoff produces zero requests. Check expired cooldown resumes without clearing newer observations.
4. Replay429 numeric600 and HTTP date through real Edge→RPC: account and unit deadline at least the provider wait from response observation; no cursor advance/position commit; stale receipt cannot erase a later cooldown. Include one-hour boundary and the explicitly blocked3601-second case until the SQL contract is resolved.
5. Replay first/stale/recent/invalid/future cursors, five-minute explicit window and the supported30-day explicit request; inspect effective provider request lower/upper filters, binding clamp and overlap. Validate manual rediscovery without widening. API500 saturation remains blocked/diagnosed separately.
6. Use the earlier anonymized structural fixture for duplicates, repeated batch, reversed events and monotonic latest. Bind its labels to own QA UUIDs and rebase dates once if required; identical duplicates must keep identical payload/timestamps. Validate actual transactional receipt, row counts/hash uniqueness, CAS, queue and tenant visibility in native SQL/UI.
7. Run final combined validation, all unit shards and database/E2E on the same SHA. Reconcile affected deployed Edge bundles including the new relative policy dependency before promotion; deploying Vercel alone cannot publish this Edge correction. Preserve active cooldowns in rollback and keep existing typed dates/receipt fields compatible. Native review and release remain the parent's responsibility.

## Owned paths

`supabase/functions/ssx-poll-positions/{index.ts,poll-policy.ts}`, `supabase/functions/agvlog-pipeline-run/index.ts`, `src/test/{ssxPositionPollPolicy.test.ts,ssxPositionPollPolicyRuntime.test.ts,ssxPipelineChaining.test.ts}`, and this document. Coordinator/Vault planning notes precede edits. No dependency, baseline, SQL, Auth, capability or shared-utils change.
