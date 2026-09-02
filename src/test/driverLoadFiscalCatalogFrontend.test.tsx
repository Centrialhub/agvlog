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
  responses: [] as Array<{ data: unknown; error: unknown }>,
}));

vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: ids.tenant } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: ids.actor } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mock.rpc } }));
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

  it('opens only an HTTPS file returned by the scoped file RPC', async () => {
    let clickedHref = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedHref = this.href;
    });
    mock.responses = [
      { data: safeCatalog, error: null },
      { data: { load_id: ids.load, kind: 'cte', document_id: ids.cte, format: 'pdf', source: 'url', filename: 'cte-7001.pdf', url: 'https://files.example.test/cte-7001.pdf' }, error: null },
    ];
    render(<Story />);
    fireEvent.click(screen.getByRole('button', { name: /Documentos fiscais/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir PDF do CT-e 7001' }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith('driver_get_load_fiscal_file', {
      _tenant_id: ids.tenant,
      _load_id: ids.load,
      _document_kind: 'cte',
      _document_id: ids.cte,
      _format: 'pdf',
    }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(clickedHref).toBe('https://files.example.test/cte-7001.pdf');
    click.mockRestore();
  });

  it('rejects an unsafe file URL without navigating', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    mock.responses = [
      { data: safeCatalog, error: null },
      { data: { load_id: ids.load, kind: 'nfse', document_id: ids.nfse, format: 'xml', source: 'url', filename: 'nfse-8001.xml', url: 'javascript:alert(1)' }, error: null },
    ];
    render(<Story />);
    fireEvent.click(screen.getByRole('button', { name: /Documentos fiscais/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir XML do NFS-e 8001' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível abrir o arquivo fiscal');
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it('downloads an inline CT-e XML without making another network request', async () => {
    let downloadedName = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadedName = this.download;
    });
    const NativeUrl = URL;
    const createObjectUrl = vi.fn(() => 'blob:cte-7001');
    const revokeObjectUrl = vi.fn();
    class FileUrl extends NativeUrl {
      static override createObjectURL = createObjectUrl;
      static override revokeObjectURL = revokeObjectUrl;
    }
    vi.stubGlobal('URL', FileUrl);
    mock.responses = [
      { data: safeCatalog, error: null },
      { data: { load_id: ids.load, kind: 'cte', document_id: ids.cte, format: 'xml', source: 'inline', filename: 'cte-7001.xml', content: '<cteProc />' }, error: null },
    ];
    render(<Story />);
    fireEvent.click(screen.getByRole('button', { name: /Documentos fiscais/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir XML do CT-e 7001' }));
    await waitFor(() => expect(createObjectUrl).toHaveBeenCalledTimes(1));
    expect(downloadedName).toBe('cte-7001.xml');
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:cte-7001');
  });
});
