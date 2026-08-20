# Data Quality Center & Baseline Implementation Plan

Transform `/data-audit` into a comprehensive **Data Quality Center** to monitor and repair architectural inconsistencies across the multi-tenant system.

## User Review Required
> [!IMPORTANT]
> The "Baseline Consolidation" step involves marking the current database state as the reference for new environments. This assumes all current migrations are valid and "zero criticals" are achieved.

## Technical Details

### 1. Database Infrastructure
- **Refined Audit RPC (`audit_data_consistency_v4`)**:
    - **Vínculos & Órfãos**: Detects loads with missing trip relations and vice-versa.
    - **Espelhos & Estados**: Validates status congruence between `dispatch_trips` and `dispatch_stops`.
    - **Duplicidades**: Identifies duplicated fiscal document keys.
    - **Security (RLS)**: Automatically audits if any public table lacks RLS.
    - **Funções Antigas**: Detects legacy RPC signatures.
- **Repair Workspace (`data_repair_batches`)**:
    - Immutable log of repair operations.
    - Requires `dry_run_report` before execution.
    - Two-step approval flow (`draft` -> `approved` -> `executed`).
    - Transactional execution with `p_batch_id` via `execute_data_repair_v1`.

### 2. Frontend Transformation
- **Renamed Page**: `/data-audit` -> `/data-quality`.
- **UI Components**:
    - **Score Dashboard**: Visual representation of database health.
    - **Metadata Inspection**: Drill down into the raw JSON metadata of inconsistencies.
    - **Selection & Batching**: Select specific items to include in a repair batch.
    - **Baseline Guard**: Visual indication if the environment is ready for baseline (zero criticals).

### 3. Implementation Steps
1.  **Renaming**: Move `DataAudit.tsx` to `DataQualityCenter.tsx` and update routing.
2.  **Schema Update**: Deploy migration for `v4` audit, repair batches, and RLS hardening.
3.  **UI Overhaul**: Implement the selection logic and batch creation in the Quality Center.
4.  **Verification**: Execute automated contract tests for schema, RLS, and signature integrity.

## Safety & Rollout
- Repairs use `SECURITY DEFINER` with explicit `search_path` and `admin` role checks.
- Direct `UPDATE/DELETE` from frontend is prohibited; all changes go through the repair RPC.
- Baseline is generated as a snapshot of current migrations once all critical issues are resolved.
