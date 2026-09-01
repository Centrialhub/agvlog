import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import BillingPage from '@/pages/BillingPage';
import NFSeFromInvoicesDialog from '@/components/nfse/NFSeFromInvoicesDialog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBillingDocuments } from '@/hooks/useBillingDocuments';
import { usePendingInvoices } from '@/hooks/usePendingInvoices';
import { useCreateFiscalDocument } from '@/hooks/useFiscalDocuments';
import { isSameFiscalMunicipality } from '@/lib/fiscal/fiscalMunicipality';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>, requests: [] as URL[], failTable: '', tenant: 'tenant',
  emitters: [] as Row[], savedInvoice: '',
  emitter: {id: 'emitter', active: true, is_default: true, city_code: '3143302', endereco: {municipio: 'Montes Claros', uf: 'MG'}},
}));
vi.mock('@/hooks/useTenant', () => ({useTenant: () => ({currentTenant: {id: state.tenant}})}));
vi.mock('@/hooks/useAuth', () => ({useAuth: () => ({user: {id: 'actor'}})}));
vi.mock('@/hooks/useEmitters', () => ({useDefaultEmitter: () => ({data: state.emitter, isLoading: false, error: null}), useEmitters: () => ({data: state.emitters})}));
vi.mock('@/hooks/useClients', () => ({useClients: () => ({data: []})}));
vi.mock('@/hooks/useLoads', () => ({useLoads: () => ({data: []}), LOAD_STATUSES: [], LOAD_STATUS_LABELS: {}}));
vi.mock('@/hooks/useBilling', () => ({useCteBatches: () => ({data: []}), useCancelCteBatch: () => ({}), useIssuedCtes: () => ({data: []}), useDeleteIssuedCte: () => ({})}));
vi.mock('@/hooks/useUserUiPreference', () => ({useUserUiPreference: () => ({preference: {invoiceNumber: state.savedInvoice}, isLoaded: true, savePreference: vi.fn()})}));
vi.mock('@/hooks/useSonnerToast', () => ({useSonnerToast: () => ({success: vi.fn(), error: vi.fn(), info: vi.fn()})}));
vi.mock('@/hooks/useRecalculateInboundFreight', () => ({useRecalculateInboundFreight: () => ({})}));
vi.mock('@/hooks/useInsuranceProfile', () => ({useInsuranceProfile: () => ({}), useUpdateInsuranceProfile: () => ({})}));
vi.mock('@/hooks/useNFSe', () => ({useCreateNFSe: () => ({}), useIssueNFSe: () => ({})}));
vi.mock('@/components/billing/CteEmissionPreviewDialog', () => ({CteEmissionPreviewDialog: () => null}));
vi.mock('@/components/billing/CancelCteDialog', () => ({CancelCteDialog: () => null}));
vi.mock('@/hooks/useFreightCalculator', () => ({calculateFreight: vi.fn(), logFreightCalculation: vi.fn()}));
vi.mock('@/integrations/supabase/client', async () => {
  const {createClient} = await import('@supabase/supabase-js');
  // Exercise the real PostgREST client against a small in-memory HTTP fixture.
  const fetchFixture: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); state.requests.push(url);
    const table = url.pathname.split('/').pop()!;
    if (table === state.failTable || (table === 'cte_documents' && url.searchParams.has('deleted_at'))) {
      return new Response(JSON.stringify({message: 'consulta indisponível'}), {status: 400});
    }
    if (init?.method === 'POST') {
      const row = {id: 'new-import-' + state.rows[table].length, ...JSON.parse(String(init.body))};
      state.rows[table].push(row);
      return new Response(JSON.stringify(row), {status: 201});
    }
    let rows = state.rows[table] || [];
    for (const [field, expression] of url.searchParams) {
      if (['select', 'order', 'offset', 'limit'].includes(field)) continue;
      rows = rows.filter(row => {
        const value = row[field];
        if (expression === 'not.is.null') return value != null;
        if (expression === 'is.null') return value == null;
        if (expression.startsWith('eq.')) return String(value) === expression.slice(3);
        if (expression.startsWith('neq.')) return value != null && String(value) !== expression.slice(4);
        if (expression.startsWith('not.in.')) return !JSON.parse('[' + expression.slice(8, -1) + ']').includes(value);
        if (expression.startsWith('in.')) return expression.slice(4, -1).split(',').includes(String(value));
        if (expression.startsWith('ilike.')) return String(value).toLowerCase().includes(expression.slice(7, -1).toLowerCase());
        throw new Error('Unhandled fixture filter: ' + expression);
      });
    }
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = Math.min(Number(url.searchParams.get('limit') || 1000), 1000);
    return new Response(JSON.stringify(rows.slice(offset, offset + limit)), {status: 200});
  };
  return {supabase: createClient('https://fixture.invalid', 'test-anon-key', {
    auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false}, global: {fetch: fetchFixture},
  })};
});

let client: QueryClient;
function Wrapper({children}: PropsWithChildren) {return <QueryClientProvider client={client}>{children}</QueryClientProvider>;}
const invoice = (id: string, extra: Row = {}): Row => ({
  id, tenant_id: 'tenant', document_type: 'inbound', status: 'confirmed', deleted_at: null,
  cte_emitted_at: null, nfse_emitted_at: null, recipient_city: 'Janaúba', recipient_state: 'MG',
  invoice_number: id, issue_date: '2026-08-21', value: 100, ...extra,
});
const emission = (id: string, source: string, extra: Row = {}): Row => ({
  id, tenant_id: 'tenant', fiscal_document_ids: [source], status: 'issued',
  is_voided: false, cancelled_at: null, cancelled: false, is_preview: false, ...extra,
});
beforeEach(() => {
  state.rows = {fiscal_documents: [], cte_documents: [], nfse_documents: []};
  state.requests = []; state.failTable = ''; state.tenant = 'tenant';
  state.emitters = [state.emitter]; state.savedInvoice = '';
  client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
});
afterEach(() => {cleanup(); client.clear();});

it('splits 60 new unbilled invoices into 11 local NFS-e and 49 nonlocal CT-e sources', async () => {
  state.rows.fiscal_documents = Array.from({length: 60}, (_, i) => invoice(String(i), {
    recipient_city: i < 11 ? 'MONTES CLAROS' : 'Janaúba', emitter_id: null, load_id: 'load',
  }));
  const {result} = renderHook(() => ({cte: useBillingDocuments({}, 'cte'), nfse: useBillingDocuments({}, 'nfse'), summary: usePendingInvoices()}), {wrapper: Wrapper});
  await waitFor(() => expect(result.current.cte.isSuccess && result.current.nfse.isSuccess && result.current.summary.isSuccess).toBe(true));
  expect(result.current.cte.data).toHaveLength(49);
  expect(result.current.nfse.data).toHaveLength(11);
  expect(result.current.nfse.data?.every(d => d.recipient_city === 'MONTES CLAROS')).toBe(true);
  expect(result.current.summary.data.count).toBe(60);
  expect(result.current.cte.data?.some(d => d.recipient_city === 'MONTES CLAROS')).toBe(false);
});

it('keeps homonymous destinations in another state out of NFS-e', async () => {
  state.rows.fiscal_documents = [invoice('local', {recipient_city: '  Montes   Claros/MG ', recipient_state: 'Minas Gerais'}), invoice('other-state', {recipient_city: 'Montes Claros', recipient_state: 'SP'})];
  const {result} = renderHook(() => ({cte: useBillingDocuments({}, 'cte'), nfse: useBillingDocuments({}, 'nfse')}), {wrapper: Wrapper});
  await waitFor(() => expect(result.current.cte.isSuccess && result.current.nfse.isSuccess).toBe(true));
  expect(result.current.cte.data?.map(d => d.id)).toEqual(['other-state']);
  expect(result.current.nfse.data?.map(d => d.id)).toEqual(['local']);
});

it('never bypasses issued flags, references or tenant boundaries when searching a specific invoice', async () => {
  state.rows.fiscal_documents = ['available', 'cte-flag', 'nfse-flag', 'cte-issued', 'nfse-issued', 'processing', 'other-tenant', 'deleted', 'cancelled', 'outbound']
    .map(id => invoice(id));
  Object.assign(state.rows.fiscal_documents[1], {cte_emitted_at: '2026-08-31'});
  Object.assign(state.rows.fiscal_documents[2], {nfse_emitted_at: '2026-08-31'});
  Object.assign(state.rows.fiscal_documents[6], {tenant_id: 'other'});
  Object.assign(state.rows.fiscal_documents[7], {deleted_at: '2026-08-31'});
  Object.assign(state.rows.fiscal_documents[8], {status: 'cancelled'});
  Object.assign(state.rows.fiscal_documents[9], {document_type: 'outbound'});
  state.rows.cte_documents = [emission('cte1', 'cte-issued'), emission('cte2', 'processing', {status: 'processing'})];
  state.rows.nfse_documents = [emission('nfse1', 'nfse-issued', {fiscal_document_ids: JSON.stringify(['nfse-issued'])})];
  const {result} = renderHook(() => useBillingDocuments({onlySpecificInvoices: state.rows.fiscal_documents.map(d => String(d.id))}), {wrapper: Wrapper});
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.map(d => d.id)).toEqual(['available']);
  expect(state.requests.every(url => url.searchParams.get('tenant_id') === 'eq.tenant')).toBe(true);
});

it('keeps draft, preview, rejected and cancelled source invoices available', async () => {
  const statuses = ['draft', 'generated', 'rejected', 'error', 'failed', 'sefaz_error', 'cancelled'];
  state.rows.fiscal_documents = [...statuses, 'preview', 'voided', 'cancelled-at'].map(id => invoice(id));
  state.rows.cte_documents = statuses.map(status => emission(status, status, {status}));
  state.rows.cte_documents.push(emission('voided', 'voided', {is_voided: true}), emission('cancelled-at', 'cancelled-at', {cancelled_at: '2026-08-31'}));
  state.rows.nfse_documents = [emission('preview', 'preview', {is_preview: true})];
  const {result} = renderHook(() => useBillingDocuments({}), {wrapper: Wrapper});
  await waitFor(() => expect(result.current.data).toHaveLength(10));
});

it('paginates invoices and both emission sources beyond the API row cap', async () => {
  state.rows.fiscal_documents = Array.from({length: 1201}, (_, i) => invoice(String(i)));
  for (const table of ['cte_documents', 'nfse_documents']) {
    state.rows[table] = Array.from({length: 1001}, (_, i) => emission(String(i), 'unrelated-' + i));
  }
  state.rows.cte_documents[1000].fiscal_document_ids = ['1199'];
  state.rows.nfse_documents[1000].fiscal_document_ids = ['1200'];
  const {result} = renderHook(() => useBillingDocuments({}), {wrapper: Wrapper});
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toHaveLength(1199);
  expect(result.current.data?.some(d => ['1199','1200'].includes(d.id))).toBe(false);
});

it.each(['fiscal_documents', 'cte_documents', 'nfse_documents', 'fiscal_source_reservations', 'hub_fiscal_emissions'])('reports %s failures instead of returning an empty successful list', async table => {
  state.failTable = table;
  const {result} = renderHook(() => useBillingDocuments({}), {wrapper: Wrapper});
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.data).toBeUndefined();
});

it('matches city filters with or without accents', async () => {
  state.rows.fiscal_documents = [invoice('janauba')];
  const {result} = renderHook(() => useBillingDocuments({recipientCity: 'JANAUBA'}), {wrapper: Wrapper});
  await waitFor(() => expect(result.current.data).toHaveLength(1));
});

it('refreshes both billing lists and the summary immediately after importing an NF', async () => {
  const {result} = renderHook(() => ({cte: useBillingDocuments({}, 'cte'), nfse: useBillingDocuments({}, 'nfse'), summary: usePendingInvoices(), create: useCreateFiscalDocument()}), {wrapper: Wrapper});
  await waitFor(() => expect(result.current.cte.isSuccess && result.current.nfse.isSuccess).toBe(true));
  await act(async () => {await result.current.create.mutateAsync({document_type: 'inbound', status: 'confirmed', invoice_number: '999', recipient_city: 'Janaúba', recipient_state: 'MG'});});
  await waitFor(() => {
    expect(result.current.cte.data).toHaveLength(1);
    expect(result.current.nfse.data).toHaveLength(0);
    expect(result.current.summary.data.count).toBe(1);
  });
  await act(async () => {await result.current.create.mutateAsync({document_type: 'inbound', status: 'confirmed', invoice_number: '1000', recipient_city: 'Montes Claros', recipient_state: 'MG'});});
  await waitFor(() => {
    expect(result.current.cte.data).toHaveLength(1);
    expect(result.current.nfse.data).toHaveLength(1);
    expect(result.current.summary.data.count).toBe(2);
  });
});

describe('municipality matching', () => {
  it('normalizes accents, spacing, city suffixes and state names', () => {
    expect(isSameFiscalMunicipality({city: '  São   Paulo / SP', state: 'São Paulo'}, {city: 'SAO PAULO', state: 'sp'})).toBe(true);
  });
  it('does not conflate same-name cities in different states or missing addresses', () => {
    expect(isSameFiscalMunicipality({city: 'Bom Jesus', state: 'PI'}, {city: 'Bom Jesus', state: 'RS'})).toBe(false);
    expect(isSameFiscalMunicipality({}, {})).toBe(false);
  });
  it('prefers valid IBGE codes when both are available', () => {
    expect(isSameFiscalMunicipality({code: '3143302'}, {code: '3143302'})).toBe(true);
    expect(isSameFiscalMunicipality({city: 'Bom Jesus', code: '2201903'}, {city: 'Bom Jesus', code: '4302303'})).toBe(false);
  });
});

// Optional local replay: no customer source data is checked into the repository.
function batchInvoices(): Row[] {
  const snapshot = process.env.BILLING_INVOICE_SNAPSHOT;
  if (snapshot) return (JSON.parse(readFileSync(snapshot, 'utf8')) as Row[]).map(row => invoice(String(row.invoice_number), row));
  return Array.from({length: 60}, (_, i) => invoice('NF-' + i, {recipient_city: i < 11 ? 'MONTES CLAROS' : 'JANAUBA'}));
}

it('renders all 49 CT-e sources after clearing the saved filter, without any of the 11 local invoices', async () => {
  state.rows.fiscal_documents = batchInvoices();
  const local = state.rows.fiscal_documents.filter(row => row.recipient_city === 'MONTES CLAROS');
  const other = state.rows.fiscal_documents.filter(row => row.recipient_city !== 'MONTES CLAROS');
  state.savedInvoice = String(local[0].invoice_number);
  render(<MemoryRouter><Wrapper><BillingPage /></Wrapper></MemoryRouter>);
  await waitFor(() => expect(screen.getByText(/Nenhuma nota/)).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', {name: 'Mostrar todas as NFs não faturadas'}));
  await waitFor(() => expect(screen.getByText('Exibindo 1–49 de 49')).toBeInTheDocument());
  const cells = new Set(Array.from(document.querySelectorAll('td')).map(cell => cell.textContent?.trim()));
  for (const row of other) expect(cells.has(String(row.invoice_number))).toBe(true);
  for (const row of local) expect(cells.has(String(row.invoice_number))).toBe(false);
});

it('renders precisely the 11 local NFS-e sources and restores them after clearing filters', async () => {
  state.rows.fiscal_documents = batchInvoices();
  const local = state.rows.fiscal_documents.filter(row => row.recipient_city === 'MONTES CLAROS');
  const other = state.rows.fiscal_documents.filter(row => row.recipient_city !== 'MONTES CLAROS');
  render(<MemoryRouter><Wrapper><NFSeFromInvoicesDialog open onOpenChange={vi.fn()} /></Wrapper></MemoryRouter>);
  expect(screen.getByRole('dialog', {name: /Emitir NFS-e a partir de NFs/})).toHaveAccessibleDescription(
    'Selecione as notas, revise os valores e informe os dados fiscais antes de emitir.',
  );
  await waitFor(() => expect(screen.getByRole('cell', {name: String(local[0].invoice_number)})).toBeInTheDocument());
  const cells = new Set(Array.from(document.querySelectorAll('td')).map(cell => cell.textContent?.trim()));
  for (const row of local) expect(cells.has(String(row.invoice_number))).toBe(true);
  for (const row of other) expect(cells.has(String(row.invoice_number))).toBe(false);
  fireEvent.change(screen.getByPlaceholderText('Filtrar por cidade...'), {target: {value: 'Janauba'}});
  await waitFor(() => expect(screen.getByText('Nenhuma NF disponível')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', {name: 'Mostrar todas as NFs não faturadas'}));
  await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(12));
  const restoredCells = new Set(Array.from(document.querySelectorAll('td')).map(cell => cell.textContent?.trim()));
  for (const row of local) expect(restoredCells.has(String(row.invoice_number))).toBe(true);
});

it.each(['cte','nfse'] as const)('removes an authorized %s source from every list, including explicit searches',async type=>{
 state.rows.fiscal_documents=[invoice('447165',{recipient_city:type==='cte'?'Coracao de Jesus':'Montes Claros'})];
 const {result}=renderHook(()=>({cte:useBillingDocuments({onlySpecificInvoices:['447165']},'cte'),nfse:useBillingDocuments({},'nfse'),summary:usePendingInvoices()}),{wrapper:Wrapper});
 await waitFor(()=>expect(result.current[type].data).toHaveLength(1));
 state.rows.fiscal_documents[0][type+'_emitted_at']='2026-08-31T16:12:48Z';state.rows[type+'_documents']=[emission('270','447165',{status:type==='cte'?'authorized':'issued'})];
 await act(async()=>{await client.invalidateQueries({queryKey:['billing_documents']});});
 await waitFor(()=>{expect(result.current.cte.data).toHaveLength(0);expect(result.current.nfse.data).toHaveLength(0);expect(result.current.summary.data.count).toBe(0);});
 state.rows.fiscal_documents[0][type+'_emitted_at']=null;
 await act(async()=>{await client.invalidateQueries({queryKey:['billing_documents']});});
 expect(result.current[type].data).toHaveLength(0);
});

it('hides uncertain dispatches without catalog entries but retains rejected, unsent and sandbox invoices', async () => {
  const cases = ['uncertain', 'in_flight', 'processing', 'authorized', 'rejected', 'unsent', 'sandbox', 'other-tenant'];
  state.rows.fiscal_documents = cases.map(id => invoice(id));
  state.rows.fiscal_source_reservations = cases.map(source_id => ({source_id, outbound_id: source_id, tenant_id: 'tenant', environment: 'production'}));
  state.rows.hub_fiscal_emissions = cases.filter(id => id !== 'unsent').map(id => ({
    id, fiscal_document_id: id, dispatch_key: id, dispatch_state: ['uncertain', 'in_flight'].includes(id) ? id : 'recorded',
    status: ['sandbox', 'other-tenant'].includes(id) ? 'processing' : id,
    environment: id === 'sandbox' ? 'homologation' : 'production', tenant_id: id === 'other-tenant' ? 'other' : 'tenant',
  }));
  const {result} = renderHook(() => useBillingDocuments({onlySpecificInvoices: cases}), {wrapper: Wrapper});
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.map(d => d.id)).toEqual(['rejected', 'unsent', 'sandbox', 'other-tenant']);
  state.rows.hub_fiscal_emissions[0] = {...state.rows.hub_fiscal_emissions[0], dispatch_state: 'recorded', status: 'rejected'};
  await act(async () => {await result.current.refetch();});
  await waitFor(() => expect(result.current.data?.map(d => d.id)).toContain('uncertain'));
});

it('reserves NFS-e timeouts and paginates durable reservations beyond the API limit', async () => {
  state.rows.fiscal_documents = [invoice('nfse-pending', {recipient_city: 'Montes Claros'}), invoice('local-free', {recipient_city: 'Montes Claros'})];
  state.rows.fiscal_source_reservations = Array.from({length: 1001}, (_, i) => ({source_id: i === 1000 ? 'nfse-pending' : 'irrelevant-' + i, nfse_id: String(i), tenant_id: 'tenant', environment: 'production'}));
  state.rows.hub_fiscal_emissions = Array.from({length: 1001}, (_, i) => ({id: String(i), nfse_document_id: String(i), dispatch_key: String(i), dispatch_state: 'uncertain', status: 'error', tenant_id: 'tenant', environment: 'production'}));
  const {result} = renderHook(() => useBillingDocuments({}, 'nfse'), {wrapper: Wrapper});
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.map(d => d.id)).toEqual(['local-free']);
});

it('excludes legacy authorized CT-e links with no timestamp, reservation or catalog row', async () => {
  const cases = ['authorized', 'processing', 'rejected', 'cancelled', 'draft', 'homologation', 'other-tenant'];
  state.rows.fiscal_documents = cases.map(id => invoice(id, {cte_emitted_outbound_id: 'out-' + id}));
  state.rows.hub_fiscal_emissions = cases.map(id => ({id, fiscal_document_id: 'out-' + id, dispatch_key: null, dispatch_state: 'legacy',
    status: ['homologation', 'other-tenant'].includes(id) ? 'authorized' : id,
    environment: id === 'homologation' ? 'homologation' : 'production', tenant_id: id === 'other-tenant' ? 'other' : 'tenant'}));
  const {result} = renderHook(() => useBillingDocuments({onlySpecificInvoices: cases}, 'cte'), {wrapper: Wrapper});
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.map(d => d.id)).toEqual(['rejected', 'cancelled', 'draft', 'homologation', 'other-tenant']);
});

it('allows an audited legacy release once, then hides the source when its new operation starts', async () => {
  state.rows.fiscal_documents = [invoice('released', {cte_emitted_outbound_id: null,
    delivery_meta: {operator_reported_cte_cancellation: {previous_outbound_id: 'old', reconciliation_pending: true}}}),
    invoice('still-linked', {cte_emitted_outbound_id: 'old'})];
  state.rows.hub_fiscal_emissions = [{id: 'old-receipt', fiscal_document_id: 'old', status: 'authorized',
    dispatch_state: 'legacy', dispatch_key: null, environment: 'production', tenant_id: 'tenant'}];
  const {result} = renderHook(() => useBillingDocuments({}, 'cte'), {wrapper: Wrapper});
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.map(d => d.id)).toEqual(['released']);
  state.rows.fiscal_source_reservations = [{source_id: 'released', outbound_id: 'new', environment: 'production', tenant_id: 'tenant'}];
  state.rows.hub_fiscal_emissions.push({id: 'new-receipt', fiscal_document_id: 'new', status: 'processing',
    dispatch_state: 'in_flight', environment: 'production', tenant_id: 'tenant'});
  await act(async () => {await result.current.refetch();});
  await waitFor(() => expect(result.current.data).toEqual([]));
});
