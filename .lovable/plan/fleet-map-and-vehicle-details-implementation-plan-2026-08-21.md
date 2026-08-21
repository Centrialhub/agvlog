# Fleet Map and Vehicle Details Implementation Plan

Implementation of a real-time fleet monitoring map and a detailed vehicle view page with historical telemetry and sensor detection.

## Proposed Changes

### Database & Schema
- No major schema changes needed; assuming `vehicles` and `positions_raw` (or similar) already exist as per memory.

### Frontend Components & Pages
#### 1. Fleet Map (`src/pages/FleetMap.tsx`)
- Implement a full-screen map using `react-leaflet` (v4.2.1).
- Fetch real-time vehicle positions from the database.
- Display vehicle markers with status-based colors (Moving, Stopped, Stale, Offline).
- Add a sidebar or overlay for vehicle listing and quick filtering.

#### 2. Vehicle Details (`src/pages/VehicleDetails.tsx`)
- Display vehicle metadata (plate, model, current driver).
- **Telemetry History**: Table or list showing recent positions, speed, and heading.
- **Sensor Detection**: UI indicators for detected sensors (e.g., ignition, doors, temperature) based on telemetry signals.
- **Mini Map**: Leaflet instance showing the vehicle's last known position or recent path.

### Navigation
- Add routes for `/fleet-map` and `/vehicles/:id` in `src/App.tsx`.
- Add sidebar links to these new sections.

## Technical Details
- **Map Library**: `react-leaflet` 4.2.1 as mandated by project memory.
- **Data Access**: Use `useQuery` hooks for fetching data; assume server-side filtering/pagination if volume is high.
- **Real-time**: Use Supabase real-time subscriptions for position updates if enabled.
- **Icons**: Lucide-react for UI icons and custom SVG/Leaflet icons for map markers.

## User Review Required
- Which specific sensors should be prioritized for detection?
- Is there a preference for the "historical" window (e.g., last 24h, last 100 points)?
- Should the Fleet Map include geofence overlays?
