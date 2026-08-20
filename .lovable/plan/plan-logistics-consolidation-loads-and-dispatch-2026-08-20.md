# Plan: Logistics Consolidation (Loads and Dispatch)

Refactor logistics execution to use `load_items` as the canonical source of truth for load composition and `dispatch_trip_loads`/`dispatch_stop_documents` for trip association.

## User Review Required

- **Data Migration**: Existing `loads.trip_id` and Direct NF-Load links will be preserved as mirrors, but the application will transition to reading/writing via the new canonical tables/RPCs.
- **Access Control**: Frontend direct writes to `loads`, `load_items`, `dispatch_trips`, `dispatch_stops`, and their relations will be revoked; all mutations will flow through transactional RPCs.

## Proposed Changes

### Database & Security

#### Schema Hardening
- Implement `link_items_to_load_v2` to atomically associate items/NFs with loads.
- Implement `plan_dispatch_trip_v2` to create trips with multi-stop document associations.
- Implement `move_load_items_v3` for reallocating cargo between loads.
- Revoke `INSERT/UPDATE/DELETE` on logistics tables from `authenticated` role.
- Revoke `EXECUTE` on new RPCs from `PUBLIC` and grant to `authenticated`.

### Frontend Infrastructure

#### Typed Repository Layer
- Update `useLoads.tsx` to use `list_loads_v1` (server-side listing) and replace direct writes with RPC calls.
- Update `useLoadItems.tsx` to use `vw_load_composition` and RPC-based mutations.
- Update `useDispatchRoutePlan.ts` to call `plan_dispatch_trip_v2`.

#### Component Refactoring
- **Loads.tsx & LoadDetail.tsx**: Replace direct Supabase calls with updated hooks.
- **LoadReallocation.tsx**: Update to use `move_load_items_v3` for transactional reallocation.

## Technical Details

### Security Guardrails
- All `SECURITY DEFINER` functions will have explicit `search_path = public` and parameter validation via `is_tenant_operator_or_admin`.

### Optimistic Locking & Audit
- Use `updated_at` for simple optimistic locking where applicable.
- Ensure all transitions are logged in `entity_state_audit_log`.
