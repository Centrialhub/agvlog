import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NFSeFromInvoicesDialog from '@/components/nfse/NFSeFromInvoicesDialog';
import NFSeFormDialog from '@/components/nfse/NFSeFormDialog';
import { calculateFreight } from '@/hooks/useFreightCalculator';
import { buildNFSeEmitPayload, type BuildNFSeInput } from '@/lib/fiscal/nfseBuilder';

const state = vi.hoisted(() => ({
  docs: [] as Record<string, unknown>[],
  docsFetching: false,
  sourceError: null as Error | null,
  revision: 1,
  gate: null as Promise<void> | null,
  rows: {} as Record<string, Record<string, unknown>[]>,
  reads: [] as string[],
  writes: [] as Record<string, unknown>[],
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
vi.mock('@/hooks/useBillingDocuments', () => ({ useBillingDocuments: () => ({ data: state.docs, refetch: state.refetch, isFetching: state.docsFetching, dataUpdatedAt: state.revision, error: state.sourceError }) }));
vi.mock('@/hooks/useFiscalDocuments', () => ({ useFiscalDocuments: () => ({ data: state.docs, isFetching: state.docsFetching, dataUpdatedAt: state.revision, error: state.sourceError }) }));
vi.mock('@/hooks/useRecalculateInboundFreight', () => ({ useRecalculateInboundFreight: () => ({ mutateAsync: state.recalc }) }));
vi.mock('@/hooks/useInsuranceProfile', () => ({ useInsuranceProfile: () => ({}), useUpdateInsuranceProfile: () => ({}) }));
vi.mock('@/hooks/useNFSe', () => ({
  useCreateNFSe: () => ({ mutateAsync: state.create }), useUpdateNFSe: () => ({ mutateAsync: state.create }),
  useIssueNFSeBatch: () => ({ mutateAsync: state.issue }),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (table: string) => {
  state.reads.push(table);
  const predicates: ((row: Record<string, unknown>) => boolean)[] = [];
  let start = 0, end = 499;
  const query = {
    select: () => query, order: () => query,
    eq: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return query; },
    is: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return query; },
    in: (key: string, values: unknown[]) => { predicates.push(row => values.includes(row[key])); return query; },
    lte: (key: string, value: string) => { predicates.push(row => String(row[key]) <= value); return query; },
    or: () => query,
    range: (from: number, to: number) => { start = from; end = to; return query; },
    update: (patch: Record<string, unknown>) => { state.writes.push(patch); return query; },
    maybeSingle: async () => ({ data: state.docs[0], error: null }),
    then: (resolve: (value: unknown) => unknown) => (state.gate ?? Promise.resolve()).then(() => ({ data: (table === 'fiscal_documents' ? state.docs : state.rows[table] || [])
      .filter(row => predicates.every(predicate => predicate(row))).slice(start, end + 1), error: null })).then(resolve),
  };
  return query;
} } }));

const source = (freight: unknown, suffix = '1') => ({
  id: `source-${suffix}`, invoice_number: suffix, value: 9876.54, freight_value: freight,
  access_key: `2926061499837100321555000000441110188076385${suffix}`,
  tenant_id: 'tenant', document_type: 'inbound', deleted_at: null, client_id: 'client',
  recipient_city: 'Belo Horizonte', recipient_state: 'MG', weight_kg: suffix === '1' ? 40 : 60, pallet_count: 1, freight_overridden: false,
  remitter_cnpj: '11222333000181', remitter: 'Tomador Teste', recipient_cnpj: '11222333000181', recipient: 'Tomador Teste',
});
const wizard = () => <NFSeFromInvoicesDialog open onOpenChange={() => {}} />;
const click = async (name: string | RegExp) => userEvent.click(screen.getByRole('button', { name }));
const valueInput = () => screen.getByRole('spinbutton', { name: 'Valor do serviço da NF 1' });
async function selectAndAdvance() {
  await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar NF 1' }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Avançar/ })).toBeEnabled());
  await click(/Avançar/);
}

beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear();
  state.sourceError = null; state.gate = null; state.revision = 1; state.reads = []; state.writes = [];
  state.rows = {
    clients: [{ id: 'supplier', tenant_id: 'tenant', tax_id: '11222333000181', is_supplier: true, payer_group: 'GROUP' }],
    client_regions: [],
    freight_tables: [{ id: 'table', tenant_id: 'tenant', client_id: 'supplier', payer_group: 'GROUP',
      table_name: 'Tabela QA', table_code: 1, blocked: false, valid_from: '2026-01-01', valid_until: null, per_kg_value: 2, min_value: 0 }],
  };
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

describe('automatic NFS-e prefill without the Recalculate button', () => {
  it.each([null, 0])('calculates a selected existing note with freight %s and sends the calculated amount', async freight => {
    state.docs = [source(freight)];
    render(wizard());
    await selectAndAdvance();
    await waitFor(() => expect(valueInput()).toHaveValue(80));
    await click(/Avançar/); await click('Emitir NFS-e');
    await waitFor(() => expect(state.sent).toHaveLength(1));
    expect(state.sent[0].payload.servico[0].valor.servico).toBe(80);
    expect(state.recalc).not.toHaveBeenCalled(); expect(state.writes).toEqual([]);
  });
  it('calculates an individually imported note without freight before saving its RPS', async () => {
    state.docs = [source(null)];
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><NFSeFormDialog open onOpenChange={() => {}} /></QueryClientProvider>);
    fireEvent.change(screen.getByPlaceholderText('Nº da NF ou Chave de Acesso'), { target: { value: '1' } });
    await click('Puxar dados');
    await userEvent.click(screen.getByRole('tab', { name: 'Itens / Valores' }));
    await waitFor(() => expect(within(screen.getAllByRole('row')[1]).getAllByRole('spinbutton')[1]).toHaveValue(80));
    await click('Criar RPS (rascunho)');
    await waitFor(() => expect(state.drafts).toHaveLength(1));
    expect(state.drafts[0].valor_servicos).toBe(80); expect(state.recalc).not.toHaveBeenCalled(); expect(state.writes).toEqual([]);
  });

  it.each(['individual', 'unified'])('calculates each selected NF independently in %s mode', async mode => {
    state.docs = [source(null), source(0, '2')]; render(wizard());
    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar NF 1' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar NF 2' }));
    await userEvent.click(screen.getByRole('radio', { name: mode === 'individual' ? /Individual/ : /Unificada/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Avançar/ })).toBeEnabled());
    await click(/Avançar/);
    expect(valueInput()).toHaveValue(80); expect(screen.getByRole('spinbutton', { name: 'Valor do serviço da NF 2' })).toHaveValue(120);
    await click(/Avançar/); await click('Emitir NFS-e');
    await waitFor(() => expect(state.sent).toHaveLength(mode === 'individual' ? 2 : 1));
    expect(state.sent.map(entry => entry.payload.servico[0].valor.servico)).toEqual(mode === 'individual' ? [80, 120] : [200]);
    expect(state.recalc).not.toHaveBeenCalled(); expect(state.writes).toEqual([]);
  });
  it.each(['missing', 'ambiguous table', 'ambiguous supplier'])('keeps emission blocked for %s without repeated calculations', async problem => {
    if(problem === 'missing') state.rows.freight_tables = [];
    if(problem === 'ambiguous table') state.rows.freight_tables.push({ ...state.rows.freight_tables[0], id: 'table2', table_code: 2 });
    if(problem === 'ambiguous supplier') state.rows.clients.push({ ...state.rows.clients[0], id: 'supplier2' });
    state.docs = [source(null)]; const view = render(wizard()); await selectAndAdvance();
    await waitFor(() => expect(valueInput()).toHaveValue(0));
    expect(screen.getByRole('button', { name: /Avançar/ })).toBeDisabled();
    const reads = state.reads.length; view.rerender(wizard());
    await act(async () => {}); expect(state.reads).toHaveLength(reads);
    expect(state.create).not.toHaveBeenCalled(); expect(state.issue).not.toHaveBeenCalled(); expect(state.recalc).not.toHaveBeenCalled();
  });
  it('refreshes a failed missing tariff automatically after the source query refresh', async () => {
    const tables = state.rows.freight_tables; state.rows.freight_tables = []; state.docs = [source(null)];
    const view = render(wizard()); await selectAndAdvance();
    await waitFor(() => expect(valueInput()).toHaveValue(0));
    state.rows.freight_tables = tables; state.revision++; view.rerender(wizard());
    await waitFor(() => expect(valueInput()).toHaveValue(80)); expect(state.recalc).not.toHaveBeenCalled();
  });
  it.each([0, 222.22])('retains a persisted deliberate manual amount %s', async freight => {
    state.docs = [{ ...source(freight), freight_overridden: true }]; render(wizard()); await selectAndAdvance();
    expect(valueInput()).toHaveValue(freight); expect(state.reads).toEqual([]);
  });
  it('does not scan unselected notes or repeat calculations on selection rerenders', async () => {
    state.docs = [source(null), source(null, '2')]; const view = render(wizard()); expect(state.reads).toEqual([]);
    await selectAndAdvance(); await waitFor(() => expect(valueInput()).toHaveValue(80));
    const reads=state.reads.length; view.rerender(wizard()); await act(async()=>{});
    expect(state.reads).toHaveLength(reads); expect(state.rows.freight_tables).toHaveLength(1);
  });
  it('blocks advance until an asynchronous automatic calculation completes', async () => {
    let release!: () => void; state.gate = new Promise<void>(resolve => { release = resolve; }); state.docs = [source(null)]; render(wizard());
    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar NF 1' }));
    expect(screen.getByRole('button', { name: /Avançar/ })).toBeDisabled(); expect(state.create).not.toHaveBeenCalled();
    await act(async()=>{ release(); });
    await waitFor(()=>expect(screen.getByRole('button', { name: /Avançar/ })).toBeEnabled());
    await click(/Avançar/); expect(valueInput()).toHaveValue(80);
  });
  it.each([0,222.22])('retains a form manual edit %s during an asynchronous calculation', async manual => {
    let release!: () => void; state.gate = new Promise<void>(resolve => { release = resolve; }); state.docs = [source(null)];
    const client = new QueryClient(); render(<QueryClientProvider client={client}><NFSeFormDialog open onOpenChange={() => {}} /></QueryClientProvider>);
    fireEvent.change(screen.getByPlaceholderText('Nº da NF ou Chave de Acesso'), { target: { value: '1' } }); await click('Puxar dados');
    await userEvent.click(screen.getByRole('tab', { name: 'Itens / Valores' }));
    const input=within(screen.getAllByRole('row')[1]).getAllByRole('spinbutton')[1]; fireEvent.change(input,{target:{value:'1'}}); fireEvent.change(input,{target:{value:String(manual)}});
    await act(async()=>{release();}); expect(input).toHaveValue(manual);
    await click('Criar RPS (rascunho)'); if(manual===0)expect(state.create).not.toHaveBeenCalled(); else await waitFor(()=>expect(state.drafts[0].valor_servicos).toBe(manual));
    expect(state.writes).toEqual([]);
  });
  it('recovers freight absent after a failed first import once a valid tariff becomes available', async () => {
    const tables=state.rows.freight_tables; state.rows.freight_tables=[];
    const imported=source(null);
    const result=await calculateFreight({tenantId:'tenant',clientId:'client',supplierTaxIds:[String(imported.remitter_cnpj)],destination:imported.recipient_city,destinationState:imported.recipient_state,destinationMunicipality:imported.recipient_city,totalValue:imported.value,totalWeight:imported.weight_kg,totalPallets:imported.pallet_count});
    expect(result.success).toBe(false); state.docs=[imported]; state.rows.freight_tables=tables;
    render(wizard()); await selectAndAdvance(); await waitFor(()=>expect(valueInput()).toHaveValue(80));
    expect(imported.freight_value).toBeNull(); expect(imported.value).toBe(9876.54); expect(state.writes).toEqual([]);
  });

  it('uses the current load query to calculate each selected invoice and save its individual amount', async () => {
    state.docs = [{ ...source(null), load_id: 'load', cte_emitted_at: null, nfse_emitted_document_id: null }, { ...source(null, '2'), load_id: 'load', cte_emitted_at: null, nfse_emitted_document_id: null }];
    const client = new QueryClient(); render(<QueryClientProvider client={client}><NFSeFormDialog open loadId="load" onOpenChange={() => {}} /></QueryClientProvider>);
    await screen.findByText('NF 1'); await click('Selecionar Todas');
    await waitFor(()=>expect(screen.getByRole('button',{name:'Criar RPS (rascunho)'})).toBeEnabled());
    await click('Criar RPS (rascunho)'); await waitFor(()=>expect(state.drafts).toHaveLength(1));
    expect(state.drafts[0].valor_servicos).toBe(200); expect(state.drafts[0].items).toEqual([expect.objectContaining({total:80}),expect.objectContaining({total:120})]);
    expect(state.recalc).not.toHaveBeenCalled(); expect(state.writes).toEqual([]);
  });
  it('keeps a mixed valid and failed note blocked instead of saving a partial freight total', async () => {
    state.docs = [source(55), { ...source(null,'2'), remitter_cnpj:'22333444000181' }]; render(wizard());
    await userEvent.click(screen.getByRole('checkbox',{name:'Selecionar NF 1'})); await userEvent.click(screen.getByRole('checkbox',{name:'Selecionar NF 2'}));
    await userEvent.click(screen.getByRole('radio',{name:/Individual/}));
    await waitFor(()=>expect(screen.getByRole('button',{name:/Avançar/})).toBeEnabled()); await click(/Avançar/);
    expect(valueInput()).toHaveValue(55); expect(screen.getByRole('spinbutton',{name:'Valor do serviço da NF 2'})).toHaveValue(0);
    expect(screen.getByRole('button',{name:/Avançar/})).toBeDisabled(); expect(state.create).not.toHaveBeenCalled();
  });
  it('refreshes the load source instead of relying on the unrelated fiscal documents query', async () => {
    state.docs = [{ ...source(null), load_id:'load', cte_emitted_at:null, nfse_emitted_document_id:null }];
    const client=new QueryClient(); render(<QueryClientProvider client={client}><NFSeFormDialog open loadId="load" onOpenChange={()=>{}} /></QueryClientProvider>);
    await screen.findByText('NF 1'); await click('Selecionar Todas');
    await userEvent.click(screen.getByRole('tab',{name:'Itens / Valores'}));
    const input=()=>within(screen.getAllByRole('row')[1]).getAllByRole('spinbutton')[1];
    await waitFor(()=>expect(input()).toHaveValue(80));
    state.docs=[{...state.docs[0],weight_kg:70}];
    await act(async()=>{await client.invalidateQueries({queryKey:['nfse_load_docs']});});
    await waitFor(()=>expect(input()).toHaveValue(140));
    await click('Criar RPS (rascunho)'); await waitFor(()=>expect(state.drafts[0].valor_servicos).toBe(140));
  });
  it('discards a late response for a removed note during rapid selection changes', async () => {
    let release!:()=>void; state.gate=new Promise<void>(resolve=>{release=resolve;}); state.docs=[source(null),source(null,'2')]; render(wizard());
    await userEvent.click(screen.getByRole('checkbox',{name:'Selecionar NF 1'}));
    await waitFor(()=>expect(state.reads).toContain('clients'));
    await userEvent.click(screen.getByRole('checkbox',{name:'Selecionar NF 1'})); await userEvent.click(screen.getByRole('checkbox',{name:'Selecionar NF 2'}));
    await act(async()=>{release();});
    await waitFor(()=>expect(screen.getByRole('button',{name:/Avançar/})).toBeEnabled()); await click(/Avançar/);
    expect(screen.queryByRole('spinbutton',{name:'Valor do serviço da NF 1'})).not.toBeInTheDocument();
    expect(screen.getByRole('spinbutton',{name:'Valor do serviço da NF 2'})).toHaveValue(120);
    await click(/Avançar/); await click('Emitir NFS-e'); await waitFor(()=>expect(state.sent).toHaveLength(1));
    expect(state.drafts[0].fiscal_document_ids).toEqual(['source-2']); expect(state.sent[0].payload.servico[0].valor.servico).toBe(120);
  });
  it('clears a closed wizard session and calculates fresh tariffs after reopening', async () => {
    state.docs=[source(null)]; const view=render(wizard()); await selectAndAdvance(); await waitFor(()=>expect(valueInput()).toHaveValue(80));
    view.rerender(<NFSeFromInvoicesDialog open={false} onOpenChange={()=>{}} />);
    state.rows.freight_tables[0].per_kg_value=3;
    view.rerender(wizard()); await waitFor(()=>expect(screen.getByRole('checkbox',{name:'Selecionar NF 1'})).not.toBeChecked());
    await selectAndAdvance(); await waitFor(()=>expect(valueInput()).toHaveValue(120));
    expect(state.recalc).not.toHaveBeenCalled(); expect(state.writes).toEqual([]);
  });
  it('ignores a response from a closed individual form and reimports using the new source', async () => {
    let release!:()=>void; state.gate=new Promise<void>(resolve=>{release=resolve;}); state.docs=[source(null)];
    const client=new QueryClient(); const component=(open:boolean)=><QueryClientProvider client={client}><NFSeFormDialog open={open} onOpenChange={()=>{}} /></QueryClientProvider>;
    const view=render(component(true)); fireEvent.change(screen.getByPlaceholderText('Nº da NF ou Chave de Acesso'),{target:{value:'1'}}); await click('Puxar dados');
    await waitFor(()=>expect(state.reads).toContain('clients')); view.rerender(component(false));
    state.docs=[source(null,'2')]; await act(async()=>{release();}); view.rerender(component(true));
    fireEvent.change(screen.getByPlaceholderText('Nº da NF ou Chave de Acesso'),{target:{value:'2'}}); await click('Puxar dados');
    await userEvent.click(screen.getByRole('tab',{name:'Itens / Valores'}));
    await waitFor(()=>expect(within(screen.getAllByRole('row')[1]).getAllByRole('spinbutton')[1]).toHaveValue(120));
    await click('Criar RPS (rascunho)'); await waitFor(()=>expect(state.drafts).toHaveLength(1));
    expect(state.drafts[0].fiscal_document_ids).toEqual(['source-2']); expect(state.drafts[0].valor_servicos).toBe(120);
  });
  it('retains manual wizard edits while source changes recalculate other notes', async () => {
    state.docs=[source(null),source(null,'2')]; const view=render(wizard());
    await userEvent.click(screen.getByRole('checkbox',{name:'Selecionar NF 1'})); await userEvent.click(screen.getByRole('checkbox',{name:'Selecionar NF 2'}));
    await userEvent.click(screen.getByRole('radio',{name:/Individual/}));
    await waitFor(()=>expect(screen.getByRole('button',{name:/Avançar/})).toBeEnabled()); await click(/Avançar/);
    fireEvent.change(valueInput(),{target:{value:'222.22'}});
    state.docs=[{...source(null),weight_kg:90},{...source(null,'2'),weight_kg:70}]; state.revision++; view.rerender(wizard());
    await waitFor(()=>expect(screen.getByRole('spinbutton',{name:'Valor do serviço da NF 2'})).toHaveValue(140)); expect(valueInput()).toHaveValue(222.22);
    await click(/Avançar/); await click('Emitir NFS-e'); await waitFor(()=>expect(state.sent).toHaveLength(2));
    expect(state.sent.map(item=>item.payload.servico[0].valor.servico)).toEqual([222.22,140]);
  });
  it('blocks final preparation while source refresh has failed and recovers without the Recalculate button', async () => {
    state.docs=[source(null)]; const view=render(wizard()); await selectAndAdvance(); await waitFor(()=>expect(valueInput()).toHaveValue(80)); await click(/Avançar/);
    state.sourceError=new Error('Source unavailable'); view.rerender(wizard()); expect(screen.getByRole('button',{name:'Emitir NFS-e'})).toBeDisabled();
    expect(state.create).not.toHaveBeenCalled(); state.sourceError=null; state.docs=[{...source(null),weight_kg:50}]; state.revision++; view.rerender(wizard());
    await waitFor(()=>expect(screen.getByRole('button',{name:'Emitir NFS-e'})).toBeEnabled()); await click('Emitir NFS-e'); await waitFor(()=>expect(state.sent).toHaveLength(1));
    expect(state.sent[0].payload.servico[0].valor.servico).toBe(100); expect(state.recalc).not.toHaveBeenCalled();
  });
  it('uses already calculated first-import freight without a second calculation or products substitution', async () => {
    const imported=source(null); const result=await calculateFreight({tenantId:'tenant',clientId:'client',supplierTaxIds:[imported.remitter_cnpj],destination:imported.recipient_city,destinationState:imported.recipient_state,destinationMunicipality:imported.recipient_city,totalValue:imported.value,totalWeight:imported.weight_kg,totalPallets:imported.pallet_count});
    expect(result.success).toBe(true); state.docs=[{...imported,freight_value:result.value}]; state.reads=[];
    render(wizard()); await selectAndAdvance(); expect(valueInput()).toHaveValue(80); expect(state.reads).toEqual([]);
    await click(/Avançar/); await click('Emitir NFS-e'); await waitFor(()=>expect(state.sent).toHaveLength(1));
    expect(state.sent[0].payload.servico[0].valor.servico).toBe(80); expect(state.docs[0].value).toBe(9876.54);
  });
  it('shows preserved drafts instead of an empty preparation after an automatic batch starts', async () => {
    state.docs = [source(null)]; state.issue.mockResolvedValue({ success: false, results: [] });
    render(wizard()); await selectAndAdvance(); await waitFor(() => expect(valueInput()).toHaveValue(80));
    await click(/Avançar/); expect(screen.getByLabelText('Resumo da emissão')).toHaveTextContent('R$ 80.00');
    await click('Emitir NFS-e'); await screen.findByRole('button', { name: 'Tentar novamente com segurança' });
    expect(screen.getByLabelText('Resumo da emissão')).toHaveTextContent('Os mesmos rascunhos');
    expect(screen.queryByText(/Informe um valor de serviço positivo/)).not.toBeInTheDocument();
    expect(screen.queryByText('Vl. Serviços')).not.toBeInTheDocument();
    expect(screen.queryByText('Alíquota ISS (%)')).not.toBeInTheDocument();
    expect(state.drafts[0].valor_servicos).toBe(80);
  });
  it('reuses saved amounts after a tariff changes and freshly calculates a new corrected batch', async () => {
    state.docs = [source(null)]; state.issue.mockResolvedValue({ success: false, results: [] });
    const view = render(wizard()); await selectAndAdvance(); await waitFor(() => expect(valueInput()).toHaveValue(80));
    await click(/Avançar/); await click('Emitir NFS-e'); await screen.findByRole('button', { name: 'Tentar novamente com segurança' });
    const firstAttempt = JSON.parse(sessionStorage.getItem('agvlog:nfse-batch:tenant:user')!);
    state.rows.freight_tables[0].per_kg_value = 3; state.revision++; view.rerender(wizard());
    await click('Tentar novamente com segurança'); await waitFor(() => expect(state.issue).toHaveBeenCalledTimes(2));
    expect(state.create).toHaveBeenCalledTimes(1); expect(state.issue.mock.calls[1][0].requestId).toBe(firstAttempt.requestId);
    expect(state.drafts[0].valor_servicos).toBe(80);
    await click('Preparar nova emissão corrigida'); await selectAndAdvance();
    await waitFor(() => expect(valueInput()).toHaveValue(120)); expect(state.recalc).not.toHaveBeenCalled();
  });
  it('recovers an automatic batch after reopening without displaying a fresh zero-valued form', async () => {
    state.docs = [source(null)]; state.issue.mockResolvedValue({ success: false, results: [] });
    const view = render(wizard()); await selectAndAdvance(); await waitFor(() => expect(valueInput()).toHaveValue(80));
    await click(/Avançar/); await click('Emitir NFS-e'); await screen.findByRole('button', { name: 'Tentar novamente com segurança' });
    view.rerender(<NFSeFromInvoicesDialog open={false} onOpenChange={() => {}} />); view.rerender(wizard());
    await screen.findByRole('button', { name: 'Tentar novamente com segurança' });
    expect(screen.queryByText(/Informe um valor de serviço positivo/)).not.toBeInTheDocument();
    expect(screen.queryByText('Vl. Serviços')).not.toBeInTheDocument();
    expect(screen.queryByText('Alíquota ISS (%)')).not.toBeInTheDocument();
    await click('Tentar novamente com segurança'); await waitFor(() => expect(state.issue).toHaveBeenCalledTimes(2));
    expect(state.create).toHaveBeenCalledTimes(1); expect(state.drafts[0].valor_servicos).toBe(80);
  });
});
