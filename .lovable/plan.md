# Plan - Logistics Intelligence & Data Access Stabilization

Fix the "missing information" issue by restoring database permissions and implement the requested logistics intelligence features (geofences, trips, and alerts).

## User Review Required

> [!IMPORTANT]
> The "missing information" is likely due to strict permission rules in recent security hardening. I will restore these permissions while maintaining multi-tenant isolation.

- Do you have specific speed limits per vehicle type, or should we use a global tenant-level default (e.g., 80km/h)?
- For geofence alerts, should we notify via UI only, or prepare the structure for future push notifications?

## Proposed Changes

### Database Security & Restoration
#### [Restoration] Security Baseline
- Create a migration to explicitly `GRANT SELECT` on all core tables (`tenants`, `memberships`, `vehicles`, `positions_*`, `trips`, `alerts`, etc.) to the `authenticated` role.
- Ensure all RLS helper functions (`get_user_tenant_ids`, `is_tenant_member`) have correct `GRANT EXECUTE` and `SET search_path = public`.

### Logistics Intelligence
#### [Feature] PostGIS Geofences & Real-time Alerts
- Implement `fn_process_position_alerts()` triggered by `positions_last` updates.
- Detect geofence `ENTER`/`EXIT` events using `ST_Within` and `ST_Distance`.
- Support overspeed detection based on `alert_rules`.
- Open/close `alert_instances` automatically.

#### [Feature] Automated Trip & Stop Detection
- Implement `calculate_vehicle_trips_v1(vehicle_id, interval)` to analyze `positions_raw`.
- Define stops as periods of inactivity (>5 mins) and trips as the segments in between.
- Persist results to `trips` and `trip_stops` tables.

### Frontend Enhancements
#### [UI] Vehicle Details & Fleet Map Integration
- Add "Alerts" tab to `VehicleDetails.tsx` with a chronological feed.
- Add "Trips & Stops" tab to `VehicleDetails.tsx` with summary metrics (KM, duration).
- Integrate alert markers on `FleetMap.tsx`.

## Technical Details

- **Geofence Logic**: Uses `ST_Intersects` on the `geofences.geometry` column.
- **Trip Logic**: Stateful calculation comparing `captured_at` and `speed` thresholds.
- **Permissions**: Follows the `public` schema grant rule for all new and existing tables.

## Constraints & Assumptions

- Relies on `react-leaflet` 4.2.1 as per core memory.
- All data access remains strictly multi-tenant via `tenant_id` filters.
