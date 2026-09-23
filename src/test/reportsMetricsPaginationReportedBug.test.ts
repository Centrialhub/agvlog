import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('paginação das métricas da tela Relatórios', () => {
  it('percorre todas as páginas com ordenação estável', () => {
    const page = readFileSync(join(process.cwd(), 'src/pages/Reports.tsx'), 'utf8');

    expect(page).toContain('fetchAllPostgrestPages((rangeFrom, rangeTo)');
    expect(page).toContain(".order('day', { ascending: false })");
    expect(page).toContain(".order('vehicle_id', { ascending: true })");
    expect(page).toContain('.range(rangeFrom, rangeTo)');
  });
});
