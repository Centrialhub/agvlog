import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { FinanceWorkspace } from '@/components/financial/FinanceWorkspace';
import { financeRouteDestinations, isFinancialPath } from '@/lib/financial/financeRoutes';

describe('navegação completa do workspace financeiro', () => {
  it.each(financeRouteDestinations)('marca %s como destino financeiro ativo', (route, label) => {
    expect(isFinancialPath(route)).toBe(true);
    render(
      <MemoryRouter initialEntries={[route]}>
        <FinanceWorkspace><main>Página financeira</main></FinanceWorkspace>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
  });
});
