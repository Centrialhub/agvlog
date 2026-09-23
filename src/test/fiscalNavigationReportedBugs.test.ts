import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cteSearchPeriod } from '@/pages/CteSearch';

describe('regressões das listas fiscais', () => {
  it('exclui notas apagadas e usa corte estritamente anterior a sete dias', () => {
    const alerts = readFileSync('src/pages/Alerts.tsx', 'utf8');
    const section = alerts.slice(alerts.indexOf('function StaleFiscalDocsSection'), alerts.indexOf('function AlertRulesSection'));
    expect(section).toContain(".is('deleted_at', null)");
    expect(section).toContain(".lt('issue_date', cutoff)");
    expect(section).not.toContain(".lte('issue_date', cutoff)");
  });

  it('envia e consome o mesmo identificador ao abrir um CT-e importado', () => {
    const summary = readFileSync('src/pages/ImportedNotesSummary.tsx', 'utf8');
    const monitor = readFileSync('src/pages/CteMonitor.tsx', 'utf8');
    expect(summary).toContain('/cte-monitor?cteId=');
    expect(monitor).toContain("searchParams.get('cteId')");
    expect(monitor).toContain('row.cte_document_id === linkedId');
    expect(monitor).toContain('row.fiscal_document_id === linkedId');
  });

  it('limpa deep links ao fechar e acompanha links alterados sem remontar', () => {
    const monitor = readFileSync('src/pages/CteMonitor.tsx', 'utf8');
    expect(monitor).toContain("next.delete('fiscalDocumentId')");
    expect(monitor).toContain("next.delete('cteId')");
    expect(monitor).toContain('docNumber: linkedDocumentNumber');
    expect(monitor).toContain('selected?.id !== linkedRow.id');
  });

  it('mantém o detalhe do Monitor de CT-e rolável dentro do viewport', () => {
    const monitor = readFileSync('src/pages/CteMonitor.tsx', 'utf8');
    expect(monitor).toContain('max-h-[calc(100dvh-2rem)] max-w-3xl overflow-y-auto');
  });

  it('exibe o protocolo apenas uma vez na grade do detalhe', () => {
    const monitor = readFileSync('src/pages/CteMonitor.tsx', 'utf8');
    const detail = monitor.slice(monitor.indexOf('function CteDetail'), monitor.indexOf('function StatusBadge'));
    expect(detail.match(/>Protocolo:<\/span>/g)).toHaveLength(1);
  });

  it('produz períodos inclusivos limitados ao dia atual', () => {
    expect(cteSearchPeriod('2026-09-21', 0)).toEqual({ issueDateStart: '2026-09-21', issueDateEnd: '2026-09-21' });
    expect(cteSearchPeriod('2026-09-21', 7)).toEqual({ issueDateStart: '2026-09-15', issueDateEnd: '2026-09-21' });
    expect(cteSearchPeriod('2026-09-21', 30)).toEqual({ issueDateStart: '2026-08-23', issueDateEnd: '2026-09-21' });
  });

  it('usa o timezone do tenant e não inventa frete com o valor da carga', () => {
    for (const file of ['src/hooks/useCteMonitor.tsx', 'src/hooks/useCteSearch.tsx']) {
      const source = readFileSync(file, 'utf8');
      expect(source).toContain('dateOnlyUtcRange(day, tenantTimezone)');
      expect(source).toContain('Number(d.freight_value ?? 0)');
      expect(source).not.toContain('Number(d.freight_value ?? d.value ?? 0)');
    }
  });
});
