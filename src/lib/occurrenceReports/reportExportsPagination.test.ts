import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('paginação do histórico de relatórios de ocorrências', () => {
  it('consulta a página pedida com total exato em vez de truncar o histórico em 200 linhas', () => {
    const hook = fs.readFileSync(
      path.resolve(process.cwd(), 'src/hooks/useOccurrenceReports.tsx'),
      'utf8',
    );

    expect(hook).toContain(".select('*', { count: 'exact' })");
    expect(hook).toContain('.range(from, from + pageSize - 1)');
    expect(hook).not.toContain('.limit(200)');
    expect(hook).toContain("queryKey: ['occurrence-report-exports', activeTenantId, page, pageSize]");
  });

  it('exibe o total e controles para alcançar relatórios antigos e pendentes', () => {
    const page = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/OccurrenceReports.tsx'),
      'utf8',
    );

    expect(page).toContain("const [reportHistoryPage, setReportHistoryPage] = useState(0)");
    expect(page).toContain("reportHistoryTotal.toLocaleString('pt-BR')");
    expect(page).toContain('Anterior');
    expect(page).toContain('Próxima');
    expect(page).toContain('Marcar enviado');
  });
});
