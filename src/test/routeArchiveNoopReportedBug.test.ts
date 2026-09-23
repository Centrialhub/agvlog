import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/pages/Routes.tsx', 'utf8');
const migration = readFileSync('supabase/migrations/20260921193620_report_route_archive_noop.sql', 'utf8');

describe('arquivamento sem efeito de corredor', () => {
  it('não oferece a ação para uma rota já inativa', () => {
    expect(page).toContain('{r.enabled && (');
  });

  it('não audita novamente e informa que o comando não mudou o estado', () => {
    const noOp = migration.slice(migration.indexOf('if not v_route.enabled then'), migration.indexOf('v_before:='));
    expect(noOp).toContain("'archived',false");
    expect(noOp).toContain("'already_archived',true");
    expect(noOp).not.toContain('_log_entity_audit');
    expect(page).toContain("if (result.archived) toast.success");
    expect(page).toContain("A rota já estava arquivada");
  });
});
