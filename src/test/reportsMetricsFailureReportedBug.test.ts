import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('falha de leitura das métricas em Relatórios', () => {
  it('interrompe os agregados vazios e oferece nova tentativa', () => {
    const page = readFileSync(join(process.cwd(), 'src/pages/Reports.tsx'), 'utf8');

    expect(page).toContain('isLoading, isError, refetch');
    expect(page).toContain('if (isError)');
    expect(page).toContain('role="alert"');
    expect(page).toContain('Os indicadores não representam um período sem atividade');
    expect(page).toContain('onClick={() => void refetch()}');
  });
});
