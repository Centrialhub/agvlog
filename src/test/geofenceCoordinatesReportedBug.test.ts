import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('defesas geográficas do mapa de cercas', () => {
  it('usa somente posições válidas no centro e nos marcadores', () => {
    const page = readSource('src/pages/Geofences.tsx');
    expect(page).toContain('positions.filter(position=>hasValidGeographicCoordinates(position.lat,position.lng))');
    expect(page).toContain('const mapCenter: [number,number]=validPositions.length>0');
    expect(page).toContain('center={mapCenter}');
    expect(page).toContain('{validPositions.map((p) => (');
  });

  it('filtra posições legadas inválidas no dashboard SQL', () => {
    const migration = readSource('supabase/migrations/20260921134500_filter_invalid_geofence_dashboard_positions.sql');
    expect(migration).toContain('position.lat between -90 and 90');
    expect(migration).toContain('position.lng between -180 and 180');
  });
});
