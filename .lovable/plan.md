# Plan for standardizing filters: Remitter, Client, City, and Supplier

The user wants to standardize filters across all relevant system tabs to include **Remetente (Remitter)**, **Cliente (Client)**, **Município (City)**, and **Fornecedor (Supplier)**.

## Areas to Update
1. **Loads (Cargas)**: Update `LoadAdvancedFilters.tsx` and the filtering logic in `Loads.tsx`.
2. **CT-e Search (Consulta CT-e)**: Ensure all four fields are available in the advanced filters.
3. **Billing (Faturamento/CT-e Hub)**: Harden the existing filters.
4. **Other Operational Pages**: `Alerts.tsx`, `Assets.tsx`, etc., if they display data that can be filtered by these entities.

## Proposed Changes

### 1. Data Models & Hooks
- Update `LoadAdvancedFiltersValue` interface to include missing fields.
- Ensure `useBillingDocuments` and `useCteSearch` hooks support these parameters (most already do, but `loads` needs client/supplier linking).

### 2. UI Components
- **`LoadAdvancedFilters.tsx`**: Add inputs for Remetente, Cliente, Município, and Fornecedor.
- **`CteSearch.tsx`**: Standardize label names and ensuring all four are present in the advanced section.
- **`Billing.tsx`**: Refine the filter layout for consistency.

### 3. Logic Update
- Update the `useMemo` filter blocks in `Loads.tsx`, `CteSearch.tsx`, and `Billing.tsx` to handle the new filter values.

## Technical Details
- Use `normalizeCity` for municipality filtering.
- Use `ilike` for text-based filters (Remetente, Cliente, Fornecedor names).
- Ensure `SENTINEL_NONE` is handled correctly for select inputs.

## User Review Required
- Should these filters be "Search as you type" (Input) or "Select from list" (Select)? 
- Given the volume of data, text inputs with `ilike` are usually safer for names, while "City" might benefit from a list derived from the current view.
