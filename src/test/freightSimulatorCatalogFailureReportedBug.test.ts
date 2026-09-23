import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/pages/FreightSimulator.tsx', 'utf8');

describe('falhas de catálogo no simulador de frete', () => {
  it('mantém os estados de erro das três consultas distintos de arrays vazios', () => {
    expect(page).toContain('clientsQuery.data ?? []');
    expect(page).toContain('regionsQuery.data ?? []');
    expect(page).toContain('docsQuery.data ?? []');
    expect(page).toContain("clientsQuery.isError ? 'fornecedores' : null");
    expect(page).toContain("regionsQuery.isError ? 'regiões' : null");
    expect(page).toContain("docsQuery.isError ? 'documentos fiscais' : null");
  });

  it('exibe falha acionável e não apresenta contagem zero durante indisponibilidade', () => {
    expect(page).toContain('role="alert"');
    expect(page).toContain('Tentar novamente');
    expect(page).toContain('{!catalogsUnavailable && (');
    expect(page).toContain('disabled={catalogsUnavailable || loading || !tenantId}');
  });

  it('impede busca e cálculo enquanto algum catálogo está indisponível', () => {
    expect(page).toContain('if (!term || !tenantId || catalogsUnavailable) return');
    expect(page).toContain('if (!tenantId || catalogsUnavailable) return');
    expect(page).toContain('disabled={catalogsUnavailable || quickSearching || !quickSearch.trim()}');
  });
});
