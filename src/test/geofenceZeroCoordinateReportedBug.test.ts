import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('centro do mapa de geofences no equador e meridiano zero', () => {
  it('preserva coordenadas zero em vez de substituí-las pelo centro padrão', () => {
    const page = readFileSync(join(process.cwd(), 'src/pages/Geofences.tsx'), 'utf8');

    expect(page).toContain('? [Number(firstValidGeofence.center_lat),Number(firstValidGeofence.center_lng)]');
    expect(page).toContain('center={mapCenter}');
    expect(page).not.toContain('Number(firstValidGeofence?.center_lat) || -14.235');
    expect(page).not.toContain('Number(firstValidGeofence?.center_lng) || -51.9253');
  });
});
