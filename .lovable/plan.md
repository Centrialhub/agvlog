# Plan: Complete Removal of Demo Functions in Driver App

We are removing all simulated data and "Demo Mode" logic from the driver application to ensure it only operates with real Supabase data.

## User Review Required

> [!IMPORTANT]
> This will permanently disable the ability to use the driver app without a real assigned trip and driver login.

## Proposed Changes

### 1. Driver App Cleanup
- **DriverDeliveries.tsx**:
    - Remove `demoStops`, `setDemoStops`, `DEMO_STOPS_INITIAL`, `DEMO_PRODUCTS_BY_STOP`.
    - Replace `DemoProduct` with a standard `Product` interface.
    - Remove `isDemo` conditional blocks in `submitEvent`, `realStopProducts` query, and UI.
    - Remove `DemoBanner` import and usage.
- **DriverStops.tsx**:
    - Remove `DEMO_TRIP`, `DEMO_STOPS_INITIAL`, `demoStops`, `setDemoStops`.
    - Remove `isDemo` logic and `DemoBanner`.
- **DriverIssues.tsx**:
    - Remove `DEMO_EVENTS_INITIAL`, `demoEvents`, `setDemoEvents`.
    - Remove `isDemo` logic and `DemoBanner`.
- **DriverExpenses.tsx**:
    - Remove `DEMO_EXPENSES_INITIAL`, `demoExpenses`, `setDemoExpenses`.
    - Remove `isDemo` logic and `DemoBanner`.
- **DriverJourney.tsx**:
    - Remove `DEMO_EVENTS_INITIAL`, `demoEvents`, `setDemoEvents`.
    - Remove `isDemo` logic and `DemoBanner`.

### 2. Core Library Cleanup
- **src/lib/driver/demoMode.ts**: Hardcode `canUseDriverDemo = false` or remove usage entirely.

## Technical Details
- Standardizing on `Product` interface for delivery items.
- Cleaning up `useMutation` hooks to only call Supabase RPCs.
- Ensuring `isDemo` is always `false` or removed where possible.
