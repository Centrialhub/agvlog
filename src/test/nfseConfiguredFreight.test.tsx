import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NFSeFromInvoicesDialog from '@/components/nfse/NFSeFromInvoicesDialog';
import NFSeFormDialog from '@/components/nfse/NFSeFormDialog';
import { buildNFSeEmitPayload, type BuildNFSeInput } from '@/lib/fiscal/nfseBuilder';

const state = vi.hoisted(() => ({
  docs: [] as Record<string, unknown>[],
  docsFetching: false,
  drafts: [] as BuildNFSeInput['doc'][],
  sent: [] as ReturnType<typeof buildNFSeEmitPayload>[],
  create: vi.fn(), issue: vi.fn(), recalc: vi.fn(), refetch: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  emitter: {
    id: 'emitter', active: true, is_default: true, regime_tributario: 'normal',
    cnpj: '11222333000181', razao_social: 'Emitente Teste', im: '123', city_code: '3106200',
    endereco: { uf: 'MG', municipio: 'Belo Horizonte', logradouro: 'Rua Teste', numero: '10', bairro: 'Centro', cep: '30110000' },
  },
  clients: [{
    id: 'client', tax_id: '11222333000181', company_name: 'Tomador Teste', state_registration: 'ISENTO',
    address_street: 'Rua Teste', address_number: '10', address_neighborhood: 'Centro',
    address_city: 'Belo Horizonte', address_city_ibge_code: '3106200', address_state: 'MG', address_zip: '30110000',
  }],
}));
vi.mock('@/hooks/useSonnerToast', () => ({ useSonnerToast: () => state.toast }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: 'tenant' } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user' } }) }));
vi.mock('@/hooks/useClients', () => ({ useClients: () => ({ data: state.clients }) }));
vi.mock('@/hooks/useEmitters', () => ({ useEmitters: () => ({ data: [state.emitter] }) }));
vi.mock('@/hooks/useBillingDocuments', () => ({ useBillingDocuments: () => ({ data: state.docs, refetch: state.refetch, isFetching: state.docsFetching }) }));
vi.mock('@/hooks/useFiscalDocuments', () => ({ useFiscalDocuments: () => ({ data: state.docs, isFetching: state.docsFetching }) }));
vi.mock('@/hooks/useRecalculateInboundFreight', () => ({ useRecalculateInboundFreight: () => ({ mutateAsync: state.recalc }) }));
vi.mock('@/hooks/useInsuranceProfile', () => ({ useInsuranceProfile: () => ({}), useUpdateInsuranceProfile: () => ({}) }));
vi.mock('@/hooks/useNFSe', () => ({
  useCreateNFSe: () => ({ mutateAsync: state.create }), useUpdateNFSe: () => ({ mutateAsync: state.create }),
  useIssueNFSeBatch: () => ({ mutateAsync: state.issue }),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (table: string) => {
  const query = {
    select: () => query, eq: () => query, is: () => query, or: () => query, in: () => query,
    maybeSingle: async () => ({ data: state.docs[0], error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === 'fiscal_source_reservations' ? [] : state.docs, error: null }).then(resolve),
  };
  return query;
} } }));

const source = (freight: unknown, suffix = '1') => ({
  id: `source-${suffix}`, invoice_number: suffix, value: 9876.54, freight_value: freight,
  access_key: `2926061499837100321555000000441110188076385${suffix}`,
  remitter_cnpj: '11222333000181', remitter: 'Tomador Teste', recipient_cnpj: '11222333000181', recipient: 'Tomador Teste',
});
const wizard = () => <NFSeFromInvoicesDialog open onOpenChange={() => {}} />;
const click = async (name: string | RegExp) => userEvent.click(screen.getByRole('button', { name }));
const valueInput = () => screen.getByRole('spinbutton', { name: 'Valor do serviço da NF 1' });
async function selectAndAdvance() {
  await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar NF 1' }));
  await click(/Avançar/);
}

beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear();
  state.docs = [source(123.45)]; state.docsFetching = false; state.drafts = []; state.sent = [];
  state.refetch.mockImplementation(async () => ({ data: state.docs, error: null }));
  state.recalc.mockResolvedValue({ updated: 1, skipped: 0, failed: 0, failedIds: [] });
  state.create.mockImplementation(async (doc: BuildNFSeInput['doc']) => {
    const saved = { ...doc, id: `10000000-0000-4000-8000-00000000000${state.drafts.length + 1}`, rps_number: String(state.drafts.length + 1) };
    state.drafts.push(saved); return saved;
  });
  state.issue.mockImplementation(async () => {
    for (const doc of state.drafts) state.sent.push(buildNFSeEmitPayload({ doc, emitter: state.emitter as BuildNFSeInput['emitter'], environment: 'production' }));
    return { success: true, results: [] };
  });
});
afterEach(cleanup);

describe('NFS-e uses configured freight independently of products', () => {
  it('does not issue the final wizard preview while its source query is refreshing', async () => {
    const view = render(wizard()); await selectAndAdvance(); await click(/Avançar/);
    state.docsFetching = true; view.rerender(wizard());
    expect(screen.getByRole('button', { name: 'Emitir NFS-e' })).toBeDisabled();
    expect(state.create).not.toHaveBeenCalled();
    state.docs = [source(333.33)]; state.docsFetching = false; view.rerender(wizard());
    await click('Emitir NFS-e'); await waitFor(() => expect(state.sent).toHaveLength(1));
    expect(state.sent[0].payload.servico[0].valor.servico).toBe(333.33);
  });

  it('does not save an individually imported automatic RPS during source refresh', async () => {
    const client = new QueryClient();
    const view = render(<QueryClientProvider client={client}><NFSeFormDialog open onOpenChange={() => {}} /></QueryClientProvider>);
    fireEvent.change(screen.getByPlaceholderText('Nº da NF ou Chave de Acesso'), { target: { value: '1' } });
    await click('Puxar dados'); state.docsFetching = true;
    view.rerender(<QueryClientProvider client={client}><NFSeFormDialog open onOpenChange={() => {}} /></QueryClientProvider>);
    expect(screen.getByRole('button', { name: 'Criar RPS (rascunho)' })).toBeDisabled();
    expect(state.create).not.toHaveBeenCalled();
  });

  it('keeps a manual amount when individually pulling the same invoice again', async () => {
    const client = new QueryClient();
    const view = render(<QueryClientProvider client={client}><NFSeFormDialog open onOpenChange={() => {}} /></QueryClientProvider>);
    fireEvent.change(screen.getByPlaceholderText('Nº da NF ou Chave de Acesso'), { target: { value: '1' } });
    await click('Puxar dados');
    await userEvent.click(screen.getByRole('tab', { name: 'Itens / Valores' }));
    fireEvent.change(within(screen.getAllByRole('row')[1]).getAllByRole('spinbutton')[1], { target: { value: '222.22' } });
    await userEvent.click(screen.getByRole('tab', { name: 'Dados Gerais' }));
    state.docs = [source(333.33)];
    view.rerender(<QueryClientProvider client={client}><NFSeFormDialog open onOpenChange={() => {}} /></QueryClientProvider>);
    await click('Puxar dados'); await click('Criar RPS (rascunho)');
    await waitFor(() => expect(state.drafts).toHaveLength(1)); expect(state.drafts[0].valor_servicos).toBe(222.22);
  });
  it('keeps wizard preparation blocked after recalculation until its source refresh resolves', async () => {
    let refreshed!: (value: unknown) => void;
    const view = render(wizard());
    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar NF 1' }));
    state.refetch.mockClear().mockImplementation(() => new Promise(resolve => { refreshed = resolve; }));
    await click('Recalcular frete');
    await waitFor(() => expect(state.refetch).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: /Avançar/ })).toBeDisabled();
    expect(state.create).not.toHaveBeenCalled();
    state.docs = [source(333.33)];
    await act(async () => { refreshed({ data: state.docs, error: null }); });
    view.rerender(wizard());
    await click(/Avançar/); expect(valueInput()).toHaveValue(333.33);
    await click(/Avançar/); await click('Emitir NFS-e');
    await waitFor(() => expect(state.sent).toHaveLength(1));
    expect(state.sent[0].payload.servico[0].valor.servico).toBe(333.33);
  });

  it.each([222.22, 0])('preserves intentional RPS service edit %s across source refresh', async amount => {
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><NFSeFormDialog open loadId="load" onOpenChange={() => {}} /></QueryClientProvider>);
    await userEvent.click(await screen.findByText('NF 1'));
    await userEvent.click(screen.getByRole('tab', { name: 'Itens / Valores' }));
    fireEvent.change(within(screen.getAllByRole('row')[1]).getAllByRole('spinbutton')[1], { target: { value: String(amount) } });
    state.docs = [source(333.33)];
    await act(async () => { client.setQueryData(['nfse_load_docs', 'load', 'production'], state.docs); });
    expect(within(screen.getAllByRole('row')[1]).getAllByRole('spinbutton')[1]).toHaveValue(amount);
    await click('Criar RPS (rascunho)');
    if (amount === 0) expect(state.create).not.toHaveBeenCalled();
    else { await waitFor(() => expect(state.drafts).toHaveLength(1)); expect(state.drafts[0].valor_servicos).toBe(amount); }
  });

  it('follows automatic freight refresh after individual invoice import', async () => {
    const client = new QueryClient();
    const view = render(<QueryClientProvider client={client}><NFSeFormDialog open onOpenChange={() => {}} /></QueryClientProvider>);
    fireEvent.change(screen.getByPlaceholderText('Nº da NF ou Chave de Acesso'), { target: { value: '1' } });
    await click('Puxar dados'); state.docs = [source(333.33)];
    view.rerender(<QueryClientProvider client={client}><NFSeFormDialog open onOpenChange={() => {}} /></QueryClientProvider>);
    await click('Criar RPS (rascunho)');
    await waitFor(() => expect(state.drafts).toHaveLength(1)); expect(state.drafts[0].valor_servicos).toBe(333.33);
  });
  it('review: follows refreshed automatic RPS freight before saving', async () => {
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><NFSeFormDialog open loadId="load" onOpenChange={() => {}} /></QueryClientProvider>);
    await userEvent.click(await screen.findByText('NF 1'));
    state.docs = [source(333.33)];
    await act(async () => { client.setQueryData(['nfse_load_docs', 'load', 'production'], state.docs); });
    await click('Criar RPS (rascunho)');
    await waitFor(() => expect(state.drafts).toHaveLength(1));
    expect(state.drafts[0].valor_servicos).toBe(333.33);
  });

  it('review: blocks RPS when refreshed automatic source freight disappears', async () => {
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><NFSeFormDialog open loadId="load" onOpenChange={() => {}} /></QueryClientProvider>);
    await userEvent.click(await screen.findByText('NF 1'));
    state.docs = [source(null)];
    await act(async () => { client.setQueryData(['nfse_load_docs', 'load', 'production'], state.docs); });
    await click('Criar RPS (rascunho)');
    expect(state.create).not.toHaveBeenCalled();
  });

  it('review: cannot advance or issue while manual freight recalculation is pending', async () => {
    let complete!: (value: unknown) => void;
    state.recalc.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    render(wizard());
    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar NF 1' }));
    await click('Recalcular frete');
    try {
      const advance = screen.getByRole('button', { name: /Avançar/ });
      const wasDisabled = advance.hasAttribute('disabled');
      if (!wasDisabled) {
        await userEvent.click(advance); await click(/Avançar/); await click('Emitir NFS-e');
        await waitFor(() => expect(state.sent).toHaveLength(1));
      }
      expect(state.sent).toEqual([]);
      expect(advance).toBeDisabled();
    } finally {
      await act(async () => { complete({ updated: 1, skipped: 0, failed: 0, failedIds: [] }); });
    }
  });
  it.each([null, undefined, 0, -1, NaN, Infinity, 'invalid', '', 0.004, 1e308])('does not prefill products for invalid/missing freight %s', async freight => {
    state.docs = [source(freight)]; render(wizard()); await selectAndAdvance();
    expect(valueInput()).toHaveValue(0);
    expect(screen.getByRole('button', { name: /Avançar/ })).toBeDisabled();
    expect(state.create).not.toHaveBeenCalled(); expect(state.issue).not.toHaveBeenCalled();
  });

  it('refreshes automatic freight after returning and recalculating instead of keeping cached products', async () => {
    state.docs = [source(null)]; const view = render(wizard()); await selectAndAdvance();
    await click('Voltar');
    state.recalc.mockImplementation(async () => {
      state.docs = [source(123.45)]; return { updated: 1, skipped: 0, failed: 0, failedIds: [] };
    });
    await click('Recalcular frete'); view.rerender(wizard()); await click(/Avançar/);
    await click(/Avançar/); await click('Emitir NFS-e');
    await waitFor(() => expect(state.sent).toHaveLength(1));
    expect(state.sent[0].payload.servico[0].valor.servico).toBe(123.45);
    expect(state.docs[0].value).toBe(9876.54);
  });

  it('preserves a deliberate service edit across freight refresh and sends that exact amount', async () => {
    const view = render(wizard()); await selectAndAdvance();
    fireEvent.change(valueInput(), { target: { value: '222.22' } });
    await click('Voltar'); state.docs = [source(333.33)]; view.rerender(wizard()); await click(/Avançar/);
    expect(valueInput()).toHaveValue(222.22);
    await click(/Avançar/); await click('Emitir NFS-e');
    await waitFor(() => expect(state.sent).toHaveLength(1));
    expect(state.sent[0].payload.servico[0].valor.servico).toBe(222.22);
    expect(state.sent[0].payload.servico[0].iss).toMatchObject({ aliquota: 5, retido: false, valor: 11.11 });
  });

  it('blocks an explicit zero edit even if source freight and products are positive', async () => {
    render(wizard()); await selectAndAdvance(); fireEvent.change(valueInput(), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: /Avançar/ })).toBeDisabled();
    expect(state.create).not.toHaveBeenCalled();
  });

  it('blocks a source losing its freight on the final preview before creating any draft', async () => {
    const view = render(wizard()); await selectAndAdvance(); await click(/Avançar/);
    state.docs = [source(null)]; view.rerender(wizard());
    expect(screen.getByRole('button', { name: 'Emitir NFS-e' })).toBeDisabled();
    expect(state.create).not.toHaveBeenCalled(); expect(state.issue).not.toHaveBeenCalled();
  });

  it.each(['individual', 'unified'])('uses freight for every source in %s mode and never masks a zero source', async mode => {
    state.docs = [source(123.45), source(0, '2')]; const view = render(wizard());
    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar NF 1' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar NF 2' }));
    await userEvent.click(screen.getByRole('radio', { name: mode === 'individual' ? /Individual/ : /Unificada/ }));
    await click(/Avançar/); expect(screen.getByRole('button', { name: /Avançar/ })).toBeDisabled();
    await click('Voltar'); state.docs = [source(123.45), source(76.56, '2')]; view.rerender(wizard()); await click(/Avançar/);
    await click(/Avançar/); await click('Emitir NFS-e');
    await waitFor(() => expect(state.sent).toHaveLength(mode === 'individual' ? 2 : 1));
    expect(state.sent.map(entry => entry.payload.servico[0].valor.servico)).toEqual(mode === 'individual' ? [123.45, 76.56] : [200.01]);
  });

  it.each([0, null, 123.45])('form invoice import uses freight %s without products fallback', async freight => {
    state.docs = [source(freight)];
    render(<QueryClientProvider client={new QueryClient()}><NFSeFormDialog open onOpenChange={() => {}} /></QueryClientProvider>);
    fireEvent.change(screen.getByPlaceholderText('Nº da NF ou Chave de Acesso'), { target: { value: '1' } });
    await click('Puxar dados'); await click('Criar RPS (rascunho)');
    if (!freight) {
      expect(state.create).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(state.drafts).toHaveLength(1));
      expect(state.drafts[0].valor_servicos).toBe(123.45);
      expect(state.drafts[0].items).toEqual([expect.objectContaining({ unit_value: 123.45, total: 123.45 })]);
    }
  });

  it('form load selection does not let one positive note mask another empty freight', async () => {
    state.docs = [source(123.45), source(null, '2')];
    render(<QueryClientProvider client={new QueryClient()}><NFSeFormDialog open loadId="load" onOpenChange={() => {}} /></QueryClientProvider>);
    await screen.findByText('NF 1'); await click('Selecionar Todas'); await click('Criar RPS (rascunho)');
    expect(state.create).not.toHaveBeenCalled();
    expect(state.toast.error).toHaveBeenCalledWith('Informe um valor de serviço positivo para cada NF selecionada.');
  });

  it('form keeps an edited item while adding a note and saves each individual value', async () => {
    state.docs = [source(123.45), source(76.56, '2')];
    render(<QueryClientProvider client={new QueryClient()}><NFSeFormDialog open loadId="load" onOpenChange={() => {}} /></QueryClientProvider>);
    await userEvent.click(await screen.findByText('NF 1'));
    await userEvent.click(screen.getByRole('tab', { name: 'Itens / Valores' }));
    const row = screen.getAllByRole('row')[1];
    fireEvent.change(within(row).getAllByRole('spinbutton')[1], { target: { value: '222.22' } });
    await userEvent.click(screen.getByRole('tab', { name: 'Dados Gerais' }));
    await userEvent.click(screen.getByText('NF 2')); await click('Criar RPS (rascunho)');
    await waitFor(() => expect(state.drafts).toHaveLength(1));
    expect(state.drafts[0].valor_servicos).toBeCloseTo(298.78, 2);
    expect(state.drafts[0].items).toEqual([
      expect.objectContaining({ fiscal_document_id: 'source-1', unit_value: 222.22, total: 222.22 }),
      expect.objectContaining({ fiscal_document_id: 'source-2', unit_value: 76.56, total: 76.56 }),
    ]);
  });
});
