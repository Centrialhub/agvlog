# Logistics Consolidation and Schema Alignment

I will reconstruct the logistics and dispatch layers to align with the canonical database schema, replacing direct frontend writes with transactional RPCs.

## Proposed Changes

### Database Layer (Postgres/Supabase)
- **Schema Alignment**: Ensure `dispatch_trip_loads` uses `dispatch_trip_id` as the primary link.
- **RPC Refactoring**:
    - Update `plan_dispatch_trip_v2` to process the new stops JSON structure (`stop_order`, `fiscal_document_ids` mapped to `document_ids`).
    - Standardize all logistics RPCs to use `SECURITY DEFINER` with `SET search_path = public` and mandatory `tenant_memberships` validation.
    - Implement `move_load_items_v3` and `link_items_to_load_v2` for atomic cargo composition.
- **Integrity**: Add `idempotency_key` support and optimistic locking via `updated_at` checks in RPCs.
- **Recalculation**: Ensure `trg_recalc_load_totals` (or RPC equivalent) maintains occupancy mirrors (`total_pallet_count`, etc.) automatically.

### Application Layer (React Hooks)
- **hook/useLoads.tsx**: Replace `insert`, `update`, and `delete` calls on `loads` table with RPC calls.
- **hook/useLoadItems.tsx**: Replace direct `load_items` operations with `link_items_to_load_v2` and `move_load_items_v3`.
- **hook/route-planning/useDispatchRoutePlan.ts**: Align the payload structure with the refactored `plan_dispatch_trip_v2`.

### Security & Validation
- Revoke all `INSERT`, `UPDATE`, and `DELETE` privileges on canonical logistics tables (`loads`, `load_items`, `dispatch_trips`, `dispatch_stops`) from `authenticated` role once RPC migration is complete.
- Enforce strict ownership validation for drivers, vehicles, clients, and items within each transaction.

## Technical Details
- **Stop Order Logic**: The frontend will pass a sorted array of stops, and the RPC will enforce `stop_order` consistency in `dispatch_stops`.
- **Mirroring**: The `loads.trip_id` field will be maintained as a mirror of the `dispatch_trip_loads` relation for query performance.
- **Testing Plan**:
    - Validate multi-cargo trip planning.
    - Test concurrent item movement between loads.
    - Verify cross-tenant isolation (attempting to move an item from another tenant should fail).
    - Ensure rollback on partial failure within transactional RPCs.
