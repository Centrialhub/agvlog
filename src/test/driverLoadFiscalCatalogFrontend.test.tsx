import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DriverLoadNotes from '@/components/driver/DriverLoadNotes';

const ids = {
  tenant: '20000000-0000-4000-8000-000000000001',
  actor: '10000000-0000-4000-8000-000000000001',
  load: '80000000-0000-4000-8000-000000000001',
  note: '90000000-0000-4000-8000-000000000001',
  cte: 'a0000000-0000-4000-8000-000000000001',
  nfse: 'b0000000-0000-4000-8000-000000000001',
};

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  responses: [] as Array<{ data: unknown; error: unknown }>,
}));

vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: ids.tenant } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: ids.actor } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mock.rpc } }));
vi.mock('@/lib/romaneioPrint', () => ({ printRomaneioRoutes: vi.fn() }));

const safeCatalog = {
  load_id: ids.load,
  documents: [
    { kind: 'nfe', id: ids.note, number: '1012', series: '1', issued_at: '2026-08-31', issuer: 'Emitente', recipient: 'Destinatário', destination_city: 'Montes Claros', destination_state: 'MG', amount: 1200, weight_kg: 450, volume_count: 12, pallet_count: 3, access_key: 'DO-NOT-RENDER' },
    { kind: 'cte', id: ids.cte, number: '7001', series: '1', issued_at: '2026-08-31', issuer: 'Emitente', recipient: 'Destinatário', destination_city: 'Montes Claros', destination_state: 'MG', amount: 180, weight_kg: 450, volume_count: null, pallet_count: 3 },
    { kind: 'nfse', id: ids.nfse, number: '8001', series: '1', issued_at: '2026-08-31', issuer: null, recipient: 'Cliente', destination_city: 'Montes Claros', destination_state: 'MG', amount: 180, weight_kg: null, volume_count: null, pallet_count: null },
  ],
};

let client: QueryClient;

function Story() {
  return (
    <QueryClientProvider client={client}>
      <DriverLoadNotes loadId={ids.load} loadNumber="1012" />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.responses = [{ data: safeCatalog, error: null }];
  mock.rpc.mockImplementation(() => ({
    abortSignal: async () => mock.responses.shift() || { data: null, error: new Error('Sem resposta QA') },
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
});

describe('DriverLoadNotes read-only fiscal catalog', () => {
  it('uses only the scoped RPC and labels NF-e, authorized CT-e and authorized NFS-e clearly', async () => {
    render(<Story />);
    fireEvent.click(screen.getByRole('button', { name: /Documentos fiscais/ }));
    expect(await screen.findByText('NF-e 1012')).toBeInTheDocument();
    expect(screen.getByText('CT-e 7001')).toBeInTheDocument();
    expect(screen.getByText('NFS-e 8001')).toBeInTheDocument();
    expect(screen.getByText('Autorizado')).toBeInTheDocument();
    expect(screen.getByText('Autorizada')).toBeInTheDocument();
    expect(screen.queryByText('DO-NOT-RENDER')).not.toBeInTheDocument();
    expect(mock.rpc).toHaveBeenCalledWith('driver_list_load_fiscal_catalog', {
      _tenant_id: ids.tenant,
      _load_id: ids.load,
    });
  });

  it('shows a query failure rather than an empty catalog and retries explicitly', async () => {
    mock.responses = [
      { data: null, error: new Error('Falha QA') },
      { data: safeCatalog, error: null },
    ];
    render(<Story />);
    fireEvent.click(screen.getByRole('button', { name: /Documentos fiscais/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível consultar');
    expect(screen.queryByText('Nenhum documento fiscal disponível')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('NF-e 1012')).toBeInTheDocument();
    expect(mock.rpc).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the RPC acknowledgement belongs to another load', async () => {
    mock.responses = [{ data: { ...safeCatalog, load_id: ids.cte }, error: null }];
    render(<Story />);
    fireEvent.click(screen.getByRole('button', { name: /Documentos fiscais/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível consultar');
    expect(screen.queryByText('NF-e 1012')).not.toBeInTheDocument();
  });
});
