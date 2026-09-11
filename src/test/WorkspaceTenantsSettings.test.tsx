import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceTenantsSettings } from '@/components/settings/WorkspaceTenantsSettings';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), activate: vi.fn(async () => true), setDefault: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/hooks/useTenant', () => ({
  useTenant: () => ({ currentTenant: { id: '10000000-0000-4000-8000-000000000001' }, activateTenantId: mocks.activate }),
}));
vi.mock('@/hooks/useWorkspaceTenants', () => ({
  useWorkspaceTenants: () => ({ data: [
    {
      id: '10000000-0000-4000-8000-000000000001', workspace_id: '90000000-0000-4000-8000-000000000001',
      name: 'Empresa A', plan_key: 'free', timezone: 'America/Sao_Paulo',
      company: { legal_name: 'Empresa A Ltda', trade_name: 'Empresa A', tax_id: '11111111000111' },
      emitters: [{ id: '20000000-0000-4000-8000-000000000001', cnpj: '11111111000111', razao_social: 'Empresa A Ltda', nome_fantasia: 'Empresa A', branch_code: 'MATRIZ', active: true, is_default: true }],
    },
    {
      id: '10000000-0000-4000-8000-000000000002', workspace_id: '90000000-0000-4000-8000-000000000001',
      name: 'Empresa B', plan_key: 'free', timezone: 'America/Sao_Paulo',
      company: { legal_name: 'Empresa B Ltda', tax_id: '22222222000122' }, emitters: [],
    },
  ], isLoading: false, error: null }),
  useSetWorkspaceTenantDefaultEmitter: () => ({ mutate: mocks.setDefault, isPending: false }),
  useCreateWorkspaceTenant: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateWorkspaceTenant: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe('gestão visual das empresas tenant', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mostra a empresa ativa, seu emitente e a pendência fiscal da outra empresa', () => {
    render(<WorkspaceTenantsSettings />);
    expect(screen.getByText('Empresas do grupo')).toBeInTheDocument();
    expect(screen.getByText('Empresa ativa')).toBeInTheDocument();
    expect(screen.getByText('Empresa A Ltda · 11.111.111/0001-11')).toBeInTheDocument();
    expect(screen.getByText(/Esta empresa não pode emitir documentos fiscais/)).toBeInTheDocument();
    expect(screen.getAllByText(/CNPJ 22\.222\.222\/0001-22/)).toHaveLength(1);
  });

  it('abre um cadastro conjunto de tenant e primeiro emitente padrão', () => {
    render(<WorkspaceTenantsSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar empresa' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Nome no seletor *')).toBeInTheDocument();
    expect(screen.getByLabelText('CNPJ da empresa *')).toBeInTheDocument();
    expect(screen.getByText('Cadastrar o primeiro emitente fiscal e defini-lo como padrão')).toBeInTheDocument();
    expect(screen.getByLabelText('CNPJ emitente *')).toBeInTheDocument();
  });
});
