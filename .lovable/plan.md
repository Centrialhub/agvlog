

## Diagnosis

Two critical bugs found:

### Bug 1: Administration/Tracker/List never works - wrong request body format
The SSX OpenAPI spec clearly shows that `/Administration/Tracker/List` expects a **`type: array` of `QueryCondition`** as the request body (same pattern as Client/List, Rule/List, etc.). The current code tries 7 body formats (`null`, `{}`, `{Filters:[]}`, etc.) but **never sends `[]` (empty array)**, which is the correct format. This causes all Administration attempts to fail with 415 (wrong format), falling back to legacy endpoints which then hit 429.

### Bug 2: `ssx-poll-positions` marks success with 0 inserts
The cursor sets `last_success_at` even when `inserted === 0`. This means the first-poll 24h window is only used once, and subsequent polls use the 15-min window. Since SSX returns historical points (393-398 points, likely spanning hours), they're all discarded as "too old". Result: **0 rows in `positions_raw` despite receiving data**.

Evidence from DB:
- `positions_raw`: 0 rows
- Logs: `points_received: 398, inserted: 0` 
- Cursor: `last_success_at` is set despite 0 inserts
- `ssx-sync-units` logs: Administration endpoints never appear in `attempted_endpoints`

---

## Plan

### 1. Fix `ssx-sync-units` - correct body format for Administration API

Update `ADMIN_CANDIDATE_BODIES` to **prioritize `[]` (empty array)** as the first body candidate, matching the OpenAPI spec. Also add `[{}]` as another variant.

```
Current order: null, {}, {Filters:[]}, {filters:[]}, {Page:1,...}, ...
New order:     [], [{}], null, {}, {Filters:[]}, ...
```

This single change should make `/Administration/Tracker/List` and `/Administration/Vehicle/v2/List` work on the first try.

### 2. Fix `ssx-poll-positions` - only mark success when rows are actually inserted

Change the cursor update logic: only set `last_success_at` when `inserted > 0`. When `inserted === 0`, keep `last_success_at` as null so the next poll still uses the 24h first-poll window.

### 3. Reset cursors to allow fresh first-poll

After deploying, the existing cursor for `PXT 0255` has `last_success_at` set incorrectly. The fix will need to handle this: either reset cursors with 0 inserts, or add a settings-based override. Will reset `last_success_at` to null for cursors where no positions exist in `positions_raw`.

### 4. Redeploy both edge functions

- `ssx-sync-units` with corrected body formats
- `ssx-poll-positions` with fixed success logic

### Files to edit:
- `supabase/functions/ssx-sync-units/index.ts` (lines 339-347: ADMIN_CANDIDATE_BODIES)
- `supabase/functions/ssx-poll-positions/index.ts` (cursor success logic)
- Migration to reset cursors

