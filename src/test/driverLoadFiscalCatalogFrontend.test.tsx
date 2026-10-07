import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  download: vi.fn(),
  actor: "10000000-0000-4000-8000-000000000001",
  responses: [] as Array<{ data: unknown; error: unknown }>,
}));

vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: ids.tenant } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mock.actor } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mock.rpc } }));
vi.mock('@/lib/driver/fiscalFileDownload', () => ({ downloadDriverFiscalFile: mock.download }));
vi.mock('@/lib/romaneioPrint', () => ({ printRomaneioRoutes: vi.fn() }));

const safeCatalog = {
  load_id: ids.load,
  documents: [
    { kind: 'nfe', id: ids.note, number: '1012', series: '1', issued_at: '2026-08-31', issuer: 'Emitente', recipient: 'Destinatário', destination_city: 'Montes Claros', destination_state: 'MG', amount: 1200, weight_kg: 450, volume_count: 12, pallet_count: 3, available_files: { pdf: false, xml: false }, access_key: 'DO-NOT-RENDER' },
    { kind: 'cte', id: ids.cte, number: '7001', series: '1', issued_at: '2026-08-31', issuer: 'Emitente', recipient: 'Destinatário', destination_city: 'Montes Claros', destination_state: 'MG', amount: 180, weight_kg: 450, volume_count: null, pallet_count: 3, available_files: { pdf: true, xml: true } },
    { kind: 'nfse', id: ids.nfse, number: '8001', series: '1', issued_at: '2026-08-31', issuer: null, recipient: 'Cliente', destination_city: 'Montes Claros', destination_state: 'MG', amount: 180, weight_kg: null, volume_count: null, pallet_count: null, available_files: { pdf: true, xml: true } },
  ],
};

let client: QueryClient;

function Story({ loadId = ids.load }: { loadId?: string } = {}) {
  return (
    <QueryClientProvider client={client}>
      <DriverLoadNotes loadId={loadId} loadNumber="1012" />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.actor = ids.actor;
  mock.download.mockReset();
  mock.responses = [{ data: safeCatalog, error: null }];
  mock.rpc.mockImplementation(() => {
    let response: { data: unknown; error: unknown } | undefined;
    const take = async () => {
      response ||= mock.responses.shift() || { data: null, error: new Error('Sem resposta QA') };
      return response;
    };
    return {
      abortSignal: take,
      then: (resolve: (value: { data: unknown; error: unknown }) => unknown, reject?: (reason: unknown) => unknown) => take().then(resolve, reject),
    };
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('DriverLoadNotes read-only fiscal catalog', () => {
  it('does not query every load until the driver opens its fiscal catalog', async () => {
    render(<Story />);
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Romaneio NF-e' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Documentos fiscais/ }));
    expect(await screen.findByText('NF-e 1012')).toBeInTheDocument();
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });

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

  it.each(['pdf', 'xml'] as const)('downloads authorized %s bytes and immediately revokes the local URL', async format => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const createObjectURL = vi.fn(() => 'blob:local-fixture329');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', class extends URL {
      static override createObjectURL = createObjectURL;
      static override revokeObjectURL = revokeObjectURL;
    });
    const blob = new Blob([format === 'pdf' ? '%PDF-1.7 fixture' : '<cteProc/>']);
    mock.download.mockResolvedValue({ blob, filename: 'cte-7001.' + format });
    render(<Story />);
    fireEvent.click(screen.getByRole('button', { name: /Documentos fiscais/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir ' + format.toUpperCase() + ' do CT-e 7001' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(mock.download).toHaveBeenCalledWith({ tenantId: ids.tenant, actorId: ids.actor, loadId: ids.load,
      kind: 'cte', documentId: ids.cte, format }, expect.any(AbortSignal));
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-fixture329');
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });

  it('shows a finite download failure without opening a provider URL', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    mock.download.mockRejectedValue(new Error('UNAUTHORIZED fixture'));
    render(<Story />);
    fireEvent.click(screen.getByRole('button', { name: /Documentos fiscais/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir PDF do CT-e 7001' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível abrir o arquivo fiscal');
    expect(click).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Abrir PDF do CT-e 7001' })).not.toBeDisabled();
  });

  it.each(['actor', 'load'])('aborts and discards a pending download after %s changes', async contextChange => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    let resolve: (file: { blob: Blob; filename: string }) => void = () => undefined;
    mock.download.mockImplementation(() => new Promise(done => { resolve = done; }));
    const story = render(<Story />);
    fireEvent.click(screen.getByRole('button', { name: /Documentos fiscais/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir PDF do CT-e 7001' }));
    mock.responses = [{ data: { ...safeCatalog, load_id: contextChange === 'load' ? ids.note : ids.load }, error: null }];
    if (contextChange === 'actor') mock.actor = ids.note;
    story.rerender(<Story loadId={contextChange === 'load' ? ids.note : ids.load} />);
    const signal = mock.download.mock.calls[0][1] as AbortSignal;
    expect(signal.aborted).toBe(true);
    resolve({ blob: new Blob(['%PDF-1.7 fixture']), filename: 'cte-7001.pdf' });
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(click).not.toHaveBeenCalled();
  });
});
