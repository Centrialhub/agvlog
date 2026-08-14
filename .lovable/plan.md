# Plan - Fix "Ghost" Invoices in Billing Pool

The user reported that several invoices (e.g., 446069, 446072, 444798) are not appearing in the **CT-e Hub (Billing)** even though they are confirmed and have no active CT-e. Investigation shows these invoices were likely once linked to failed or deleted CT-e drafts, and although the CT-e rows were removed, the invoices are still being filtered out by the frontend logic that cross-references active documents.

## Proposed Changes

### 1. Database & RLS Consistency
- I will verify if there are any "orphaned" draft or error documents in `cte_documents` or `nfse_documents` that are not visible to the current user but are being included in the frontend fetch.
- Since I cannot run `UPDATE` directly, I will implement a "Self-Healing" mechanism in the frontend hooks to ignore documents that are inconsistent.

### 2. Frontend Hook Hardening (`src/hooks/useBillingDocuments.tsx`)
- Modify the cross-reference logic to only block invoices that are linked to documents in "Authorized" or "Transmitting" states.
- Explicitly exclude any `cte_documents` or `nfse_documents` that are in `error`, `rejected`, or `cancelled` states from the blocking Set (`emittedIds`).
- Add a explicit check to ignore documents that don't belong to the current tenant (extra safety).

### 3. Cleanup of Stale Invoices
- I will provide a button or a routine in the UI (temporary or permanent) to "Recalcular integridade" which will re-fetch and force a cache invalidation.
- Actually, the best approach is to fix `useBillingDocuments` to be more resilient to stale/failed draft records.

## Technical Details

- **File**: `src/hooks/useBillingDocuments.tsx`
  - Update `queryFn` to filter `emitted` documents more strictly.
  - Currently, it uses `isVoidFiscalStatus(row.status)` via `cteConsumesInvoices`.
  - I will check if `isVoidFiscalStatus` correctly handles all edge cases like "drafts that failed to transmit".
- **File**: `src/hooks/usePendingInvoices.tsx`
  - Apply the same strict filtering to ensure the KPI count matches the table.
- **SQL Audit**: Use the UI to verify if there are any `hub_fiscal_emissions` stuck in `processing` that the user can't see but the system considers "active".

## Verification Plan

1. **Simulate/Check**: I will use a script to check if `emittedIds` in `useBillingDocuments` actually contains the IDs of the "ghost" invoices.
2. **Implementation**: Deploy the stricter filtering.
3. **Verification**: Refresh the preview and check if the invoices 446069, 446072, etc., appear in the billing list.
