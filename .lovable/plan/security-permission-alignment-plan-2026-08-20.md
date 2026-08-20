# Security Permission Alignment Plan

This plan implements a forward-only migration to fix excess permissions granted in previous migrations (20260820230138 and 20260820230214) without breaking active frontend workflows. It establishes a rigorous security baseline for RPC access and multi-tenant isolation.

## User Review Required

> [!IMPORTANT]
> This will restrict database function access to only what the frontend explicitly uses. If you have custom scripts or integrations using other RPCs, they may require additional grants.

## Proposed Changes

### Database Security (Migration `20260820233000`)
- **Revoke Broad Permissions**: Revokes `EXECUTE` on all functions from `PUBLIC` and `authenticated` roles initially.
- **RPC Access Matrix**: Explicitly grants `EXECUTE` only to the ~70 RPCs identified as used by the frontend.
- **Tenant Isolation**: Forces all `SECURITY DEFINER` functions to validate tenant membership, role, and ownership before execution.
- **Neutralize Unstable Modules**:
    - `execute_data_repair_v1`: Forces a `FEATURE_DISABLED` exception and revokes access.
    - `plan_dispatch_start_trip_v1`: Revokes access in favor of `plan_dispatch_trip_v2`.
- **View Security**: Updates logistics read models to use `security_invoker = true` where applicable or ensures RLS is respected.

### Verification & CI
- **Automated Regression Tests**: New test suite `src/test/securityMigrationV2.test.ts` to verify unauthorized access is blocked (cross-tenant and neutralized modules).
- **CI Gate**: Ensures the migration history integrity and type safety.

## Technical Details
- **Migration Strategy**: Forward-only, idempotent SQL.
- **Helper Function**: Uses `public.check_tenant_membership(p_tenant_id)` as a standardized guard.
- **Roles**:
    - `anon`: Only onboarding/portal login RPCs.
    - `authenticated`: Only frontend-whitelisted RPCs with membership checks.
    - `service_role`: Full access for system triggers and Edge Functions.
