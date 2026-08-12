# Plan - Manual Taker Editing in NFS-e Ingestion

Enable manual editing of taker information in the NFS-e emission flow from invoices to handle cases where registry data is incomplete or incorrect.

## User Review Required

> [!IMPORTANT]
> The current flow automatically derives taker data (remitter or recipient) from the selected invoices. This plan adds a manual override section in the final step of the wizard.

## Proposed Changes

### NFS-e Ingestion Flow (`NFSeFromInvoicesDialog.tsx`)

- Add `overrideTomador` state to allow users to manually edit pre-filled fields.
- Implement an "Editar dados do tomador" toggle/section in Step 3.
- Allow editing of: Name, CNPJ, IE, IM, Address, Number, Neighborhood, City, State, CEP, IBGE Code, Email, and Phone.
- Update the emission logic to use overridden values if present.

### NFS-e Payload Builder (`nfseBuilder.ts`)

- Ensure the builder handles incoming data correctly (it already does, but verification is needed for any field mismatch).

## Technical Details

### Frontend Changes

- **`src/components/nfse/NFSeFromInvoicesDialog.tsx`**:
    - Add state: `const [manualTomador, setManualTomador] = useState<any>(null);`
    - In Step 3, replace the read-only summary with a set of inputs that pre-fill from the derived `tomador` but allow manual changes.
    - Synchronize the `tomador` derivation to update the manual state if it hasn't been touched, or keep user edits.
    - Update `handleEmit` to send the `manualTomador` fields to the `create.mutateAsync` call.

### Verification Plan

- Test deriving a taker from an invoice.
- Edit a field (e.g., street name) manually.
- Verify the created NFS-e document in the database has the edited value.
- Verify that changing the "Tomador é: (Remetente/Destinatário)" toggle correctly resets/updates the editable fields.
