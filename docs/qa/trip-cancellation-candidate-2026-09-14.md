# Audited planned-trip cancellation candidate — 2026-09-14

Local candidate for review. No remote mutation, commit or deployment was performed by this subtask.

## Behavior and contract

`preview_dispatch_trip_cancellation(_tenant_id uuid, _trip_id uuid)` returns version, tenant/actor/trip IDs, current status, revision, can_execute, blockers with counts, load_ids, stop_ids, completed_cancellation and nullable historical result. It omits private `_evidence`.

`cancel_dispatch_trip(_payload jsonb)` accepts version 1, tenant_id, trip_id, request_id, expected_revision and reason (10–2000 characters). It derives the actor from auth.uid(), rechecks authorization on replay, and returns the same recorded result for the same request/payload. Public APIs grant authenticated only; private helpers and journal remain owner-only.

The eligible operation is a planned trip without actual departure/end, operational events, accepted cargo custody, money/expense/payable/settlement dependencies, delivery evidence or incompatible issued fiscal evidence. Existing physical journeys must be planned and not shared. Started trips and dependencies remain explicit blockers. The planner sets a load to `loading` before physical execution; that state is eligible only alongside all the preceding checks. `loaded` remains blocked.

The command changes the trip and pending stops to cancelled, cancels its singleton physical journey, and clears only the active loads.trip_id mirror. It retains load status/content, dispatch_trip_loads, stop-document associations, fiscal records and all audit history. A new dispatch can use the unchanged load and notes. The existing replanning assertion ignores historical stop associations only when the new cancellation journal proves their retirement.

## Scope of guards

The 25 direct-reference triggers serialize writes with the trip row. For trips without this new cancellation journal they do not impose a new business-state rejection; they can return a concurrency retry when a parent is locked. For a journal-cancelled trip they prevent new evidence, reassignment of historical links, deletion and reactivation. Notes/updated_at-only edits of trip/stop history remain permitted. Stop-document associations have a corresponding trip lock; the physical journey guard prevents reactivation while permitting metadata/updated_at-only changes. The cancellation journal itself is immutable.

This does not cancel any fiscal document, issue a new document, post money, write payroll or erase history. Ordinary cancellation by legacy mechanisms is not retroactively frozen by these journal-scoped guards.

## Production read-only evidence

Captured definitions and normalized body hashes in `trip-cancellation-predecessors-2026-09-14.json`; relation types/nullability in `trip-cancellation-production-columns-2026-09-14.json`. Actual dispatch/stop/fiscal status fields are NOT NULL; direct trip references are UUID. The metadata query found one planned/non-started trip with one load and one stop and no events/custody/expenses/batches/payables/settlements/NFS-e. This identifies a useful supported branch, not which trip the user intended.

The production v3 dispatcher delegates to v2, which delegates to the base dispatcher. Their exact retrieved bodies and ACL metadata are in `trip-cancellation-dispatch-trace-2026-09-14.json`. The integration test installs those three bodies and invokes v3 as authenticated, using valid map-selected coordinates. The location wrappers and planner functions are not modified by these migrations.

## Verification

8 SQL tests passed at 17:25:43: private cancellation/replay/history retention, dependency/stale rejection, tenant/mixed-driver rejection, retained inbound provenance/replanning, actual v3 dispatch→cancel→v3 dispatch, authenticated public schemas/replay with raw/anon denial, altered-core preflight rejection, and central-audit failure rolling the entire cancellation back. Public DTOs parse with the actual UI schemas. ESLint on seven new test/helper/runner files passed.

Four native PostgreSQL 17.11 disputes passed on final core hash (session 69882, exit 0, cluster stopped): cancellation first versus new expense rejects 40001; expense first makes cancellation stale 40001; cancellation first prevents waiting direct departure 55000; departure first makes cancellation stale 40001. The departure cases use direct status UPDATE, not the current driver custody/start API. Native log: `trip-cancellation-native-2026-09-14.log`.

Fixture limits: the planner fixture retains real planning/delivery/financial trigger definitions and graph constraints, but is not a full Supabase environment. Additional dependency tables model existence/reference blocking, not all of those domains' writers. Tenant context is supplied by a fixture helper, not by a real signed browser JWT. The v3 location test exercises the map-selected branch, not a geocoding network operation. Physical journey fixture state is explicitly created; no claim of full workspace grouping integration is made.

## Frozen SQL

- `supabase/migrations/20260914200012_audited_planned_trip_cancellation.sql`
  SHA256 `7915b095ca92d8f9a037dbc29cb980cf174992075948370712e3a98e9862e685`
- `supabase/migrations/20260914201830_planned_trip_cancellation_public_boundary.sql`
  SHA256 `301c37715b08301743e16fc9a2d3fc61e6c47ae55ab0f911142b20436fae5515`

The boundary pins six new private function bodies/flags/ACL/search paths and every installed trip/history guard. The core pins four existing function bodies before its narrow replanning overlay. Root owns production preflight/apply and UI publication.

## Allowlist for this subtask

- supabase/migrations/20260914200012_audited_planned_trip_cancellation.sql
- supabase/migrations/20260914201830_planned_trip_cancellation_public_boundary.sql
- src/test/tripCancellation.test.ts
- src/test/tripCancellationPlanning.test.ts
- src/test/tripCancellationPublicBoundary.test.ts
- src/test/helpers/tripCancellationDatabase.ts
- src/test/helpers/tripCancellationPlanningDatabase.ts
- scripts/test-trip-cancellation-native.mjs
- scripts/test-trip-cancellation-native-cases.mjs
- docs/qa/trip-cancellation-predecessors-2026-09-14.json
- docs/qa/trip-cancellation-production-columns-2026-09-14.json
- docs/qa/trip-cancellation-dispatch-trace-2026-09-14.json
- docs/qa/trip-cancellation-core-catalog-2026-09-14.json
- docs/qa/trip-cancellation-native-2026-09-14.log
- docs/qa/trip-cancellation-candidate-2026-09-14.md

TripDetailsDrawer/UI/client changes belong to root and are not included in this subtask allowlist.
