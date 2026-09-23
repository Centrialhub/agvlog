import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NFSePage from '@/pages/NFSe';
import CteMonitor from '@/pages/CteMonitor';
import type { NFSeDoc } from '@/hooks/useNFSe';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({
  nfse: {
    data: [] as NFSeDoc[],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  cte: {
    data: [] as unknown[],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
}));

vi.mock('@/hooks/useNFSe', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useNFSe')>('@/hooks/useNFSe');
  const mutation = () => ({ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() });
  return {
    ...actual,
    useNFSeList: () => state.nfse,
    useIssueNFSe: mutation,
    useCancelNFSe: mutation,
    useDeleteNFSe: mutation,
    useSyncNFSeStatus: mutation,
    useResendNFSe: mutation,
    fetchNfseHubRefs: vi.fn(async () => new Map()),
  };
});

vi.mock('@/hooks/useCteMonitor', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useCteMonitor')>('@/hooks/useCteMonitor');
  return {
    ...actual,
    useCteMonitor: () => state.cte,
    useCteSefazEvents: () => ({ data: [] }),
    useResendCte: () => ({ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() }),
  };
});

vi.mock('@/hooks/useIssueCTe', () => ({
  useCancelCTe: () => ({ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() }),
}));
vi.mock('@/hooks/useAlertStore', () => ({
  useScopedAlerts: () => ({ promptAction: vi.fn(), confirmAction: vi.fn() }),
}));
vi.mock('@/hooks/useSonnerToast', () => ({
  useSonnerToast: () => ({ loading: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock('@/components/nfse/NFSeFormDialog', () => ({ default: () => null }));
vi.mock('@/components/nfse/NFSeFromInvoicesDialog', () => ({ default: () => null }));
vi.mock('@/components/billing/PendingInvoicesBanner', () => ({ PendingInvoicesBanner: () => null }));

function nfse(id: number, status = 'issued'): NFSeDoc {
  return {
    id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    rps_number: String(id),
    nfse_number: null,
    series: '1',
    issue_date: '2026-09-15',
    cliente_nome: `Cliente ${id}`,
    cliente_cnpj: null,
    reference_number: null,
    valor_servicos: 100,
    valor_iss: 2,
    status,
    items: [],
  } as unknown as NFSeDoc;
}

beforeEach(() => {
  Object.assign(state.nfse, { data: [], isLoading: false, isFetching: false, isError: false, error: null });
  Object.assign(state.cte, { data: [], isLoading: false, isFetching: false, isError: false, error: null });
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('estados da lista NFS-e', () => {
  it('mostra falha com retry sem mascará-la como lista vazia', () => {
    state.nfse.data = [nfse(99, 'draft')];
    state.nfse.isError = true;
    state.nfse.error = new Error('NFS-e indisponível');
    render(<MemoryRouter><NFSePage /></MemoryRouter>);

    expect(screen.getByRole('alert')).toHaveTextContent('NFS-e indisponível');
    expect(screen.queryByText('Nenhuma NFS-e para os filtros selecionados')).not.toBeInTheDocument();
    expect(screen.queryByText('RPS 99')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Excluir/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(state.nfse.refetch).toHaveBeenCalledOnce();
  });

  it('oferece exclusão somente para rascunho e rejeitada', () => {
    state.nfse.data = [nfse(1, 'draft'), nfse(2, 'rejected'), nfse(3, 'error'), nfse(4, 'authorized')];
    render(<MemoryRouter><NFSePage /></MemoryRouter>);
    expect(screen.getAllByRole('button', { name: /Excluir/ })).toHaveLength(2);
  });

  it('pagina a tabela sem esconder os registros posteriores ao primeiro lote visual', () => {
    state.nfse.data = Array.from({ length: 51 }, (_, index) => nfse(index + 1));
    render(<MemoryRouter><NFSePage /></MemoryRouter>);
    expect(screen.queryByText('RPS 51')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(screen.getByText('RPS 51')).toBeInTheDocument();
    expect(screen.getByText('Página 2 de 2')).toBeInTheDocument();
  });
});

describe('estados do Monitor CT-e', () => {
  it('mostra falha com retry sem renderizar o estado vazio', () => {
    state.cte.isError = true;
    state.cte.error = new Error('Monitor indisponível');
    render(<MemoryRouter><CteMonitor /></MemoryRouter>);

    expect(screen.getByRole('alert')).toHaveTextContent('Monitor indisponível');
    expect(screen.queryByText('Nenhum CT-e encontrado para os filtros informados.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(state.cte.refetch).toHaveBeenCalledOnce();
  });
});
