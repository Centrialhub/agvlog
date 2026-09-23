import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration=readFileSync('supabase/migrations/20260921200610_bound_control_tower_trip_collections.sql','utf8');
const contracts=readFileSync('src/lib/controlTower/contracts.ts','utf8');
const drawer=readFileSync('src/components/control-tower/TripDetailsDrawer.tsx','utf8');

describe('limites das coleções aninhadas da Torre',()=>{
  it('limita paradas e cargas antes da agregação e devolve totais',()=>{
    expect(migration.match(/limit 50/g)).toHaveLength(2);
    expect(migration).toContain('limit 25');
    expect(migration).toContain('previous_stops.total as previous_stops_total');
    expect(migration).toContain('loads.total as loads_total');
  });

  it('valida e sinaliza cada resumo parcial',()=>{
    expect(contracts).toContain('row.pending_stops_total>row.pending_stops.length');
    expect(drawer).toContain('Paradas pendentes resumidas neste painel e no mapa.');
    expect(drawer).toContain('Lista de cargas resumida neste painel.');
  });
});
