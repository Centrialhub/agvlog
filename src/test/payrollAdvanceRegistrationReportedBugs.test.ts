import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('cadastro de adiantamento', () => {
  const source = readFileSync('src/components/financial/payroll/PayrollAdvances.tsx', 'utf8');
  const page = readFileSync('src/pages/Payroll.tsx', 'utf8');

  it('exige data antes de iniciar a persistência', () => {
    expect(source).toContain('<Label className="text-xs">Data *</Label>');
    expect(source).toContain('<Input required type="date"');
    expect(source).toContain('||!advanceDate||reason.trim().length<10');
    expect(source).toContain('Funcionário, valor e data são obrigatórios');
  });

  it('distingue carregamento e falha da lista vazia de funcionários', () => {
    expect(source).toContain('employeesQuery.isPending || employeesQuery.isFetching');
    expect(source).toContain('Consultando funcionários…');
    expect(source).toContain('Não foi possível consultar os funcionários:');
    expect(source).toContain('employeesQuery.refetch()');
  });

  it('reinicia o formulário quando a empresa ativa muda', () => {
    expect(page).toContain("key={currentTenant?.id ?? 'none'}");
  });
});
