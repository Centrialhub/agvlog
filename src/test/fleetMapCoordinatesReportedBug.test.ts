import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('defesas geográficas do mapa da frota', () => {
  it('normaliza coordenadas inválidas do snapshot sem remover o veículo da lista', () => {
    const hook = readSource('src/hooks/useWorkspaceFleet.ts');
    expect(hook).toContain('hasValidGeographicCoordinates(row.lat, row.lng)');
    expect(hook).toContain('{ ...row, lat: null, lng: null }');
  });

  it('filtra novamente os pontos antes de alimentar o Leaflet', () => {
    const page = readSource('src/pages/FleetMap.tsx');
    expect(page).toContain('filtered.filter(e => hasValidGeographicCoordinates(e.lat, e.lng))');
  });

  it('neutraliza coordenadas legadas inválidas no contrato SQL do snapshot', () => {
    const migration = readSource('supabase/migrations/20260921134000_filter_invalid_workspace_fleet_coordinates.sql');
    expect(migration).toContain('telemetry.lat between -90 and 90');
    expect(migration).toContain('telemetry.lng between -180 and 180');
    expect(migration).toContain('then telemetry.lat else null');
    expect(migration).toContain('then telemetry.lng else null');
  });
});
