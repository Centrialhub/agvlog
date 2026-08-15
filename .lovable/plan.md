# Plan - New MDF-e Information Fields and Hardening

Implement new mandatory fields for MDF-e emission based on the Hub Fiscal v1 API and resolve recent emission errors (insurance, takers, totals).

## User Review Required

> [!IMPORTANT]
> The current MDF-e implementation uses hardcoded defaults for driver and origin. These will remain as defaults but the user can now edit them in the UI.

- Does the cargo value calculation need to include taxes or only the net value from CT-es? (Assuming net `value` column for now).

## Proposed Changes

### Fiscal Engine (`src/lib/fiscal`)

#### [mdfeBuilder.ts]
- Update `MdfeInsurance` interface to match Hub Fiscal v1 requirements (ensure `nAv` is treated correctly).
- Harden `infToma` group to always use the Emitter's CNPJ as the party responsible for the MDF-e (mandatory for transport providers).
- Ensure `tot` group (totals) correctly maps `vCarga` (cargo value) and `cMone` (currency code).
- Standardize `nApol` and `nAv` fields within the `seg` (insurance) group.

### Operations / Fiscal (`src/pages`)

#### [MdfeProvisional.tsx]
- Implement state for `totalCargoValue` to track the sum of values from selected CT-es.
- Add an effect to auto-calculate the total cargo value whenever the selection changes.
- Add input fields to the emission dialog for:
    - **Total Cargo Value (R$)**: Pre-filled but editable.
    - **Insurance Details**: Show a summary of the loaded insurance profile.
- Update the transmission logic to include these new fields in the builder input.
- Add validation to ensure insurance data is present before attempting transmission.

### Hooks (`src/hooks`)

#### [useAuthorizedCteList.ts]
- Include the `value` column from `fiscal_documents` in the query to allow total cargo value calculation.

## Technical Details

- **Hub Fiscal v1 Compliance**: Mapping internal fields to the specific JSON structure required by the `hub-fiscal-proxy` Edge Function.
- **Precision**: Use `Number()` conversion for values and `toFixed(2)` for strings sent to the API.
- **Insurance Integration**: Use `useInsuranceProfile` hook which pulls data from the tenant's insurance configuration.

## verification Plan

### Automated Tests
- Run `lovable-exec test` to ensure builder logic correctly generates the JSON payload.
- Verify `cMone` is '098' (BRL) by default.

### Manual Verification
1. Navigate to /mdfe-provisional.
2. Select multiple authorized CT-es.
3. Verify that the "Total Cargo Value" in the dialog is the sum of the selected items.
4. Attempt to emit and inspect the browser console/network tab to ensure `infToma`, `tot`, and `seg` groups are correctly formed.
