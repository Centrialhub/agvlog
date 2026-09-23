import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration=readFileSync('supabase/migrations/20260921195730_bound_control_tower_alerts.sql','utf8');
const contracts=readFileSync('src/lib/controlTower/contracts.ts','utf8');
const page=readFileSync('src/pages/OperationsControl.tsx','utf8');
const panel=readFileSync('src/components/control-tower/AlertsPanel.tsx','utf8');

describe('limite explícito de alertas da Torre de Controle',()=>{
  it('prioriza e limita a resposta no banco, preservando o total',()=>{
    expect(migration).toContain('count(*) over()::integer alert_total');
    expect(migration).toContain('limit 200');
    expect(migration).toContain("'alert_limit',200,'alert_total',v_alert_total,'alerts_truncated'");
  });

  it('valida e informa truncamento na barra lateral',()=>{
    expect(contracts).toContain('snapshot.alert_total>alerts.length');
    expect(page).toContain('alertQuery.data?.alert_total??alerts.length');
    expect(panel).toContain('Exibindo {alerts.length} de {totalCount} alertas');
  });
});
