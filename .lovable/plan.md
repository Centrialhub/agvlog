

# Plan: SSX Administration Integration -- Sync Units & Auto-Discovery

## Discovery

The endpoint `/Tracking/TrackedUnit/List` **exists** -- it returns "Token invalido" (not 404). It is an undocumented endpoint that requires authentication. The current `ssx-sync-units` edge function is already correctly calling this endpoint.

## What Needs to Change

### 1. Rewrite `ssx-sync-units` to use the correct (non-versioned) URL

The current function calls `/${apiVersion}/Tracking/TrackedUnit/List` (i.e. `/v3/Tracking/TrackedUnit/List`). Both versions work, but the non-versioned path is more canonical for this undocumented endpoint. Additionally, the function should also **auto-create vehicles and auto-link** them when a `Plate` or similar field is found in the response.

Changes to `supabase/functions/ssx-sync-units/index.ts`:
- Keep existing auth/token logic (already correct)
- After upserting `provider_units`, attempt to auto-create vehicles from any `Plate` field in the response
- Auto-create `vehicle_tracker_links` between discovered vehicles and provider_units
- Return enriched stats: `vehicles_created`, `links_created`

### 2. Add "Sync Rastreadores" button to Settings UI

In the `IntegrationSection` component of `Settings.tsx`:
- Add a new button "Sync Rastreadores" next to each integration account card (alongside "Testar Login", "Sync Telemetria", "Rodar Polling")
- Wire it to call `ssx-sync-units` with `{ integration_account_id }`
- On success, invalidate `provider_units` and `vehicles` queries
- Show toast with results

### 3. Include `ssx-sync-units` in the pipeline

In `agvlog-pipeline-run/index.ts`:
- After login (Step A) and before poll (Step B), add Step A2: call `ssx-sync-units` for each account
- Add `synced_units` to stats

### 4. No migration needed

The `provider_units` table and unique index already exist. The `vehicles` table exists. No schema changes required.

## Technical Details

- The `ssx-sync-units` function currently works correctly for the API call -- the endpoint is real but undocumented
- Auto-vehicle creation: when a unit has a `Plate` field, upsert into `vehicles(tenant_id, plate)` and then create a `vehicle_tracker_links` entry if none exists
- The `provider_units` upsert uses `onConflict: "tenant_id,integration_account_id,external_code"` which is backed by the existing unique index

