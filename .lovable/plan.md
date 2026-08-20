# Stabilization and Logical Rollback Plan

## Phase 1: Database Hardening
1. **RPC `execute_data_repair_v1`**:
    - Update to require `p_dry_run` boolean.
    - Enforce maker-checker: `executed_by` (maker) must be different from `approved_by` (checker).
    - Implement per-item repair logic (looping through `data_repair_batch_items`).
    - Capture `before_state` and `after_state` in the audit log.
    - Ensure atomic transaction.
2. **RPC `list_employees_v1`**:
    - Re-implement to target the `employees` table specifically, removing the legacy driver-re-use logic.
3. **RPC `get_driver_workspace_v1`**:
    - Audit parameters and return types for frontend congruence.
4. **RPC `log_operational_event_v2`**:
    - Ensure all parameters match the latest schema (trip_id, stops, etc.).

## Phase 2: Feature Flags & UI Rollback
1. Create `src/lib/featureFlags.ts` to manage feature availability.
2. Create `src/components/FeatureFlagGate.tsx` to conditionally render components/routes.
3. Update `src/App.tsx` and `src/components/layout/AppLayout.tsx` to hide:
    - Driver Workspace (`/driver/*`)
    - Client Portal (`/portal/*`)
    - Operational Ledger (`/ledger`)
    - Data Quality Center (`/data-quality`)
4. Restore `DataAudit.tsx` as a maintenance placeholder.

## Phase 3: Typed Contracts & HR Fix
1. Update `src/hooks/useEmployees.tsx` to use the dedicated `list_employees_v1`.
2. Ensure `src/hooks/useDriverWorkspace.tsx` and related hooks handle "Feature Disabled" states gracefully.
3. Validate all RPC signatures against the hardened database schema.

## Phase 4: Validation
1. Run `db-linter.py` and `tsc` to ensure no regressions.
2. Verify that `execute_data_repair_v1` fails if conditions (dry-run, approver) aren't met.
3. Confirm HR listing no longer shows drivers by default if they aren't employees.
