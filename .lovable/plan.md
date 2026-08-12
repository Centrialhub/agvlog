# Plan: Fix NFS-e CEP and Demo Cleanup

## Part 1: Fix NFS-e CEP Validation
The Hub Fiscal is rejecting NFS-e because the CEP is not being properly resolved and formatted for the TOMADOR (taker).
- **src/components/nfse/NFSeFromInvoicesDialog.tsx**:
    - Update `tomador` memo to force `cep` validation (8 digits).
    - Ensure `tomador.cep` is explicitly passed in `handleEmit` to the `create.mutateAsync` call.
    - Check why `cliente_cep` was not hitting the backend correctly (the current `NFSeFromInvoicesDialog` uses `tomador.cep` but the `create` mutation sends `cliente_cep`).
- **src/lib/fiscal/nfseBuilder.ts**:
    - Ensure `endereco.cep` in `tomador` object is mandatory 8 digits.

## Part 2: Cleanup Driver Demo Mode
- **src/pages/driver/DriverDeliveries.tsx**:
    - Remove `demoStops`, `DEMO_STOPS_INITIAL`, `isDemo` logic.
    - Replace `DemoProduct` with a standard `DeliveryItem` or just standard types.
    - Remove `DemoBanner`.
    - Fix the TS errors identified in the last build step.
- **src/pages/driver/DriverStops.tsx**:
    - Remove `demoStops`, `DEMO_TRIP`, `DEMO_STOPS_INITIAL`, `isDemo`.
- **src/pages/driver/DriverIssues.tsx**:
    - Remove `demoEvents`, `DEMO_EVENTS_INITIAL`, `isDemo`.
- **src/pages/driver/DriverExpenses.tsx**:
    - Remove `demoExpenses`, `DEMO_EXPENSES_INITIAL`, `isDemo`.
- **src/pages/driver/DriverJourney.tsx**:
    - Remove `demoEvents`, `DEMO_EVENTS_INITIAL`, `isDemo`.
- **src/lib/driver/demoMode.ts**:
    - Set `canUseDriverDemo = false`.
