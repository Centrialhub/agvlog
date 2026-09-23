import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('defesas geográficas do detalhe do veículo', () => {
  it('normaliza a última posição e filtra cada página do histórico no hook', () => {
    const hook = readSource('src/hooks/usePositions.tsx');
    expect(hook).toContain('page.filter((position) => hasValidGeographicCoordinates(position.lat, position.lng))');
    expect(hook).toContain('position && hasValidGeographicCoordinates(position.lat, position.lng) ? position : null');
  });

  it('mantém uma segunda barreira antes dos mapas do detalhe', () => {
    const page = readSource('src/pages/VehicleDetails.tsx');
    expect(page).toContain('hasValidGeographicCoordinates(positionQuery.data?.lat, positionQuery.data?.lng)');
    expect(page).toContain('point => hasValidGeographicCoordinates(point.lat, point.lng)');
  });

  it('protege novas posições brutas e filtra as legadas no leitor SQL', () => {
    const migration = readSource('supabase/migrations/20260921135000_filter_invalid_vehicle_position_history.sql');
    expect(migration).toContain('positions_raw_valid_coordinates_check');
    expect(migration).toContain('r.lat between -90 and 90');
    expect(migration).toContain('r.lng between -180 and 180');
  });
});
