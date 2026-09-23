import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('falhas de leitura do painel operacional', () => {
  it('observa as duas fontes agregadas e bloqueia indicadores parciais', () => {
    const page = readFileSync(join(process.cwd(), 'src/pages/OperationsDashboard.tsx'), 'utf8');

    for (const query of ['dashboardQuery', 'inventoryQuery']) {
      expect(page).toContain(`query: ${query}`);
    }
    expect(page).toContain('if (failedQueries.length > 0)');
    expect(page).toContain('Nenhum indicador parcial será apresentado');
    expect(page).toContain('query.refetch()');
  });
});
