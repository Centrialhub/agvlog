# Plan: Improve Fiscal Document Synchronization and Status Accuracy

Focusing on consistency between the system status and the real Hub Fiscal status, especially for cancelled notes.

## Technical Details

### Backend (Edge Functions)
- **`nfse-status-poll` and `cte-status-poll`**:
    - Add `authorized` (CT-e) and `issued` (NFS-e) to the list of statuses to poll if the document is not yet marked as `cancelled` but has a `cancellation_requested` event or similar flag.
    - Improve classification logic to strictly follow the latest Hub Fiscal API v1 catalog (Sandbox vs Production).
    - Ensure that when a document is found to be `cancelled` in the Hub, all linked source documents (NFs) are released in the database.

### Frontend (Hooks)
- **`useCancelNFSe` and `useCancelCTe`**:
    - Update hooks to set the status to `transmitting` (or a specific `cancelling` state if available) instead of assuming immediate success.
    - Add clear feedback to the user that the system is waiting for Hub confirmation.

### Database
- Add `cancellation_requested_at` or similar markers to `nfse_documents` and `fiscal_documents` (CT-e) to prioritize these for polling.

## Proposed Changes

### Edge Functions
- `supabase/functions/nfse-status-poll/index.ts`: Expand `PENDING` statuses and ensure robust NF release.
- `supabase/functions/cte-status-poll/index.ts`: Expand `PENDING` statuses and ensure robust NF release.

### Hooks
- `src/hooks/useNFSe.tsx`: Refine `useCancelNFSe` to wait for polling.
- `src/hooks/useIssueCTe.tsx`: Refine `useCancelCTe` to wait for polling.
