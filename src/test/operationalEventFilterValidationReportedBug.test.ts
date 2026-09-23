import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateOperationalEventFilterDraft } from '@/lib/operationalEvents/filterValidation';

const valid = { search: '', impactMin: '', impactMax: '' };

describe('validação dos filtros de ocorrências operacionais', () => {
  it('rejeita intervalos e impactos inválidos antes da consulta', () => {
    expect(validateOperationalEventFilterDraft({ ...valid, dateFrom: new Date(2026, 8, 2), dateTo: new Date(2026, 8, 1) })).toMatch(/data inicial/);
    expect(validateOperationalEventFilterDraft({ ...valid, impactMin: '-1' })).toMatch(/mínimo/);
    expect(validateOperationalEventFilterDraft({ ...valid, impactMin: '20', impactMax: '10' })).toMatch(/maior que o máximo/);
    expect(validateOperationalEventFilterDraft({ ...valid, search: 'x'.repeat(201) })).toMatch(/200/);
    expect(validateOperationalEventFilterDraft({ ...valid, impactMin: '10', impactMax: '20' })).toBeNull();
  });

  it('limita os controles e desabilita a consulta enquanto houver erro', () => {
    const page = readFileSync('src/pages/OperationalEvents.tsx', 'utf8');
    expect(page.match(/maxLength=\{200\}/g)).toHaveLength(2);
    expect((page.match(/min="0"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(page).toContain('{ enabled: !filterValidation }');
    expect(page).toContain('disabled={dateTo ? { after: dateTo } : undefined}');
    expect(page).toContain('disabled={dateFrom ? { before: dateFrom } : undefined}');
  });

  it('mantém uma única âncora para o detalhamento', () => {
    const page = readFileSync('src/pages/OperationalEvents.tsx', 'utf8');
    expect(page.match(/id="detalhamento-ocorrencias"/g)).toHaveLength(1);
  });
});
