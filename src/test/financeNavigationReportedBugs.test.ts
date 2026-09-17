import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const expenses = readFileSync('src/pages/FinanceExpenses.tsx', 'utf8');
const statements = readFileSync('src/pages/FinanceStatements.tsx', 'utf8');
const statementDetail = readFileSync('src/components/financial/StatementHistoryDetail.tsx', 'utf8');
const freightHub = readFileSync('src/pages/FreightHub.tsx', 'utf8');

describe('reported finance and freight navigation regressions', () => {
  it('keeps expense content visible and announces a background refresh', () => {
    expect(expenses).toContain('const page=query.isError?undefined:query.data');
    expect(expenses).toContain('Atualizando gastos…');
  });

  it('validates the statement date relationship before applying filters', () => {
    expect(statements).toContain('draft.from>draft.to');
    expect(statements).toContain('A data inicial não pode ser posterior à data final');
    expect(statements).toContain('disabled={invalidDateRange}');
  });

  it('shows an account-catalog error and offers a retry', () => {
    expect(statementDetail).toContain('accounts.isError');
    expect(statementDetail).toContain('Não foi possível consultar as contas ativas');
    expect(statementDetail).toContain('accounts.refetch()');
  });

  it('clears an old signed statement link before requesting another one', () => {
    expect(statementDetail).toContain("setLinkBusy(true);setError('');setLink('');");
  });

  it('synchronizes freight tabs from URL changes and records tab navigation', () => {
    expect(freightHub).toContain('useEffect(() =>');
    expect(freightHub).toContain('normalizeTab(params.get');
    expect(freightHub).toContain('setParams(next);');
    expect(freightHub).not.toContain('setParams(next, { replace: true });\n        }}');
  });
});
