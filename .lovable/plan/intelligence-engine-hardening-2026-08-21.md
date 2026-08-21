---
title: Stable Intelligence & Visibility Pipeline
description: Hardens the data ingestion pipeline, intelligence engines (geofences/trips), and frontend visibility to ensure reliable real-time tracking and alerting.
---

## Intelligence Engine Hardening
- **Geofence Processing**: Validate `process_geofence_alerts` to ensure it correctly triggers `geofence_entry` and `geofence_exit` events using PostGIS.
- **Trip Detection**: Implement `calculate_vehicle_trips_v2` to segment positions into trips based on movement thresholds and idle time.
- **Overspeed Logic**: Refine `process_overspeed_alerts` to use tenant-specific speed limits defined in `tenant_settings`.

## Ingestion & Pipeline Stability
- **Broadband Polling**: Optimize `ssx-poll-positions` to handle large vehicle fleets by using bulk upserts and efficient diffing against `positions_last`.
- **State Convergence**: Ensure `agvlog-compute-state` correctly updates `vehicles_state` movement status (`moving`, `stopped`, `idle`, `offline`) based on heartbeat staleness.

## Frontend Visibility
- **Fleet Map UX**: Update `FleetMap.tsx` to display geofence polygons and real-time alert toast notifications.
- **Vehicle Timeline**: Enhance `VehicleDetails.tsx` to show a unified timeline of positions, events, and detected trips.
- **RLS Verification**: Ensure all internal roles (`owner`, `admin`, `operator`) have consistent `SELECT` access across intelligence tables via `get_user_tenant_ids()`.

## Technical Details
- Use `ST_Contains` and `ST_Distance` for geofence and proximity logic.
- Implement idempotency in `positions_raw` upserts using the `provider_payload_hash`.
- Enforce `SECURITY DEFINER` with explicit `search_path` on all intelligence-related PostgreSQL functions.
