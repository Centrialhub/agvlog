# Plan - Driver Active Trip Logic Stabilization

The user is reporting that even when a load is in transit, it sometimes doesn't show up for the driver or the active trip detection fails. We need to unify how "active trip" is determined and ensure it correctly maps to the driver's current operational reality (load assigned or trip dispatched).

## Proposed Changes

### 1. Unified Active Trip Hook (`src/hooks/useCurrentDriver.tsx`)
- Refactor `useActiveTrip` to be more robust.
- Instead of just looking for `dispatch_trips` with active statuses, it should also look for `loads` assigned to the driver that are `in_transit` or `ready`.
- Ensure it prefers a trip linked to a load that is physically in progress.

### 2. Driver Home Stabilization (`src/pages/driver/DriverHome.tsx`)
- Use the refined `useActiveTrip` hook.
- Ensure the "Checklist pending" and "Quick actions" are correctly gated by the detected active trip.
- Improve the "No loads help" logic to be more specific about why a load might be hidden (e.g., status mismatches).

### 3. Page Protections (`src/pages/driver/DriverDeliveries.tsx`, `DriverStops.tsx`, etc.)
- Add consistent "No active trip" fallbacks to all driver sub-pages.
- If a user navigates to `/driver/deliveries` without an active trip detected by the hook, show a clear message instead of crashing or showing an empty state.

## Technical Details

- **Detection Logic**: 
  1. Find trips with status in `['planned', 'loading', 'dispatched', 'in_progress', 'in_transit']`.
  2. If no trip found, look for loads assigned to the driver with status `in_transit`.
  3. If multiple found, pick the most recent one.
- **Cache Invalidation**: Ensure `current_driver` and `driver_active_trip` are invalidated when `loads` or `dispatch_trips` change for that driver.

```typescript
// Example of improved detection logic
const activeTrip = trips.find(t => 
  TRIP_ACTIVE_STATUSES.includes(t.status) || 
  t.loads?.status === 'in_transit'
) || loads.find(l => l.status === 'in_transit' && l.trip_id);
```

The goal is to make the "Active Trip" a reliable single-source-of-truth for the mobile app.
