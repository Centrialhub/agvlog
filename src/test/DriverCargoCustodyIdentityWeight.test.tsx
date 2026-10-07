import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DriverCargoCustody from '@/pages/driver/DriverCargoCustody';

const ids = {
  tenant: '73000000-0000-4000-8000-000000000001', actor: '73000000-0000-4000-8000-000000000002',
  driver: '73000000-0000-4000-8000-000000000003', trip: '73000000-0000-4000-8000-000000000004',
  vehicle: '73000000-0000-4000-8000-000000000005', load1: '73000000-0000-4000-8000-000000000006',
  load2: '73000000-0000-4000-8000-000000000007', control: '73000000-0000-4000-8000-000000000008',
  doc: '73000000-0000-4000-8000-000000000009', otherTrip: '73999999-0000-4000-8000-000000000004',
  other: '73999999-0000-4000-8000-000000000001',
};
const mocks = vi.hoisted(() => ({ getCargo: vi.fn(), updateCargo: vi.fn(), upload: vi.fn(), toast: vi.fn(),
  read: vi.fn(), put: vi.fn(), from: vi.fn(), identityResponse: vi.fn(), context: {
    tenant: '', actor: '', driver: '', online: true,
  } }));

vi.mock('@/hooks/useCurrentDriver', () => ({
  useCurrentDriver: () => ({ data: { id: mocks.context.driver, name: 'QA', tenant_id: mocks.context.tenant, active: true }, isPending: false }),
  useActiveTrip: () => ({ data: { id: ids.otherTrip, status: 'loading', vehicle_id: ids.other,
    vehicles: { plate: 'ERR0000' }, loads: { id: ids.other, load_number: '9999' } }, isPending: false }),
}));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: mocks.context.tenant } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mocks.context.actor } }) }));
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => mocks.context.online }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/lib/secureUpload', () => ({ uploadSecureFile: mocks.upload, removeSecureFiles: vi.fn() }));
vi.mock('@/lib/driver/driverOperationalOffline', () => ({ driverOperationalSnapshotStore: { read: mocks.read, put: mocks.put } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from, rpc: vi.fn() } }));
vi.mock('@/lib/driver/tripCargoCustody', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/driver/tripCargoCustody')>(),
  getCompleteTripCargoControl: mocks.getCargo, updateDriverTripCargo: mocks.updateCargo,
}));

function identityRow(overrides: Record<string, unknown> = {}) {
  return { id: ids.trip, tenant_id: mocks.context.tenant, driver_id: mocks.context.driver, vehicle_id: ids.vehicle,
    vehicles: { plate: 'PVL8973', nickname: null }, dispatch_trip_loads: [ids.load2, ids.load1].map((id, index) => ({
      load_id: id, loads: { id, load_number: index === 0 ? '1012' : '1003', origin: 'Origem', destination: 'Destino', status: 'ready' },
    })), ...overrides };
}
function cargo(available = true, weight = 7691.72607421875) {
  const base = { version: 1, trip_id: ids.trip, trip_status: 'loading' };
  return available ? { ...base, available: true, control: { id: ids.control, tenant_id: mocks.context.tenant,
    dispatch_trip_id: ids.trip, driver_id: mocks.context.driver, vehicle_id: ids.vehicle, status: 'loading',
    vehicle_checked: false, tie_down_confirmed: false, seal_not_applicable_reason: null, updated_at: '2026-10-06T12:00:00Z' },
    loads: [ids.load1, ids.load2].map((loadId, index) => ({ id: loadId, load_id: loadId,
      expected_volume_count: 10, expected_pallet_count: 2, expected_weight_kg: index === 0 ? weight : 100,
      confirmed_volume_count: null, confirmed_pallet_count: null, confirmed_weight_kg: null, confirmed_at: null })),
    documents: [{ id: ids.doc, load_id: ids.load1, source_kind: 'nfe', reference_number: 'NFE-101', driver_confirmed: true }],
    seals: [], evidence: [], divergences: [], physical_receipts: { required_count: 0, pending_count: 0, missing_count: 0 },
  } : { ...base, available: false, tenant_id: mocks.context.tenant, driver_id: mocks.context.driver, vehicle_id: ids.vehicle };
}
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context = { tenant: ids.tenant, actor: ids.actor, driver: ids.driver, online: true };
  mocks.getCargo.mockResolvedValue(cargo());
  mocks.updateCargo.mockResolvedValue({ confirmed: true });
  mocks.read.mockResolvedValue(null);
  mocks.put.mockResolvedValue(undefined);
  mocks.upload.mockImplementation(async ({ folder, file }: { folder: string; file: File }) => `${ids.tenant}/${folder}/${file.name}`);
  mocks.identityResponse.mockImplementation(async () => ({ data: identityRow(), error: null }));
  mocks.from.mockImplementation(() => {
    const filters: Record<string, string> = {};
    const chain = { select: vi.fn(() => chain), eq: vi.fn((column: string, value: string) => { filters[column] = value; return chain; }),
      abortSignal: vi.fn(() => chain), maybeSingle: () => mocks.identityResponse(filters) };
    return chain;
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); });
function view() {
  return <QueryClientProvider client={client}><MemoryRouter initialEntries={[`/driver/cargo?trip=${ids.trip}`]}>
    <DriverCargoCustody />
  </MemoryRouter></QueryClientProvider>;
}
async function loadingForm() {
  const rendered = render(view());
  await screen.findByLabelText('Identificação da viagem');
  await waitFor(() => expect(screen.getByLabelText('Identificação da viagem')).toHaveTextContent('PVL8973'));
  return rendered;
}
function fillRequired() {
  fireEvent.click(screen.getByText('Veículo conferido').closest('label')!);
  fireEvent.click(screen.getByText('Carga amarrada e estabilizada').closest('label')!);
  fireEvent.change(screen.getByLabelText('Motivo sem lacre'), { target: { value: 'Veículo sem ponto de lacre' } });
  fireEvent.change(screen.getByLabelText('Foto da carga'), { target: { files: [new File(['QA'], 'carga.jpg', { type: 'image/jpeg' })] } });
  fireEvent.change(screen.getByLabelText('Foto da amarração'), { target: { files: [new File(['QA'], 'amarracao.jpg', { type: 'image/jpeg' })] } });
}

describe('driver cargo weight and operational identity', () => {
  it('shows explicit decimal rounding and sends the valid two-place weight after the required evidence', async () => {
    await loadingForm();
    const weights = screen.getAllByLabelText('Peso kg');
    expect(weights[0]).toHaveValue(7691.73);
    expect(screen.getByRole('note')).toHaveTextContent('7691,72607421875');
    expect(screen.getByRole('note')).toHaveTextContent('7691,73 kg, com duas casas');
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar conferência da carga' }));
    await waitFor(() => expect(mocks.updateCargo).toHaveBeenCalledTimes(1));
    expect(mocks.updateCargo.mock.calls[0][0]).toMatchObject({ tripId: ids.trip, action: 'confirm_cargo',
      payload: { loads: [{ load_id: ids.load1, weight_kg: 7691.73 }, { load_id: ids.load2, weight_kg: 100 }] } });
    expect(mocks.upload).toHaveBeenCalledTimes(2);
  });

  it('keeps manual third-decimal rejection before any upload or mutation', async () => {
    await loadingForm();
    fireEvent.change(screen.getAllByLabelText('Peso kg')[0], { target: { value: '1.005' } });
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar conferência da carga' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringMatching(/duas casas/) })));
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.updateCargo).not.toHaveBeenCalled();
  });

  it('does not announce rounding for a weight already within the operational precision', async () => {
    mocks.getCargo.mockResolvedValue(cargo(true, 100.5));
    await loadingForm();
    expect(screen.getAllByLabelText('Peso kg')[0]).toHaveValue(100.5);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it.each(['90071992547409.91', '9999999999999999.99'])('rejects lost manual weight digits in %s before upload or mutation', async value => {
    await loadingForm();
    const weightInput = screen.getAllByLabelText('Peso kg')[0] as HTMLInputElement;
    fireEvent.change(weightInput, { target: { value } });
    expect(weightInput.value).toBe(value);
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar conferência da carga' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      description: expect.stringMatching(/Peso.*precisão de duas casas/),
    })));
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.updateCargo).not.toHaveBeenCalled();
  });

  it.each(['90071992547409.90', '90071992547409.92'])('retains representable manual weight %s in the confirmation command', async value => {
    await loadingForm();
    fireEvent.change(screen.getAllByLabelText('Peso kg')[0], { target: { value } });
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar conferência da carga' }));
    await waitFor(() => expect(mocks.updateCargo).toHaveBeenCalledTimes(1));
    expect(mocks.updateCargo.mock.calls[0][0]).toMatchObject({ action: 'confirm_cargo',
      payload: { loads: [{ load_id: ids.load1, weight_kg: Number(value) }, { load_id: ids.load2, weight_kg: 100 }] } });
    expect(JSON.stringify(mocks.updateCargo.mock.calls[0][0].payload.loads[0].weight_kg)).toBe(String(Number(value)));
    expect(mocks.upload).toHaveBeenCalledTimes(2);
  });

  it('uses the selected trip rather than the active trip, retaining labels by load ID and in the selector', async () => {
    await loadingForm();
    expect(screen.getByLabelText('Identificação da viagem')).toHaveTextContent('1012, 1003');
    expect(screen.getByText('Carga 1003')).toBeInTheDocument();
    expect(screen.getByText('Carga 1012')).toBeInTheDocument();
    expect(screen.queryByText(/9999|ERR0000|73000000/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Tipo de divergência'), { target: { value: 'damage' } });
    const selector = screen.getByLabelText('Carga afetada');
    expect(within(selector).getByRole('option', { name: 'Carga 1003' })).toHaveValue(ids.load1);
    expect(within(selector).getByRole('option', { name: 'Carga 1012' })).toHaveValue(ids.load2);
    expect(mocks.identityResponse).toHaveBeenCalledWith({ id: ids.trip, tenant_id: ids.tenant, driver_id: ids.driver });
  });

  it('shows complete load and plate identity before allowing acceptance', async () => {
    mocks.getCargo.mockResolvedValue(cargo(false));
    render(view());
    const accept = await screen.findByRole('button', { name: 'Aceitar viagem e veículo' });
    await waitFor(() => expect(accept).toBeEnabled());
    expect(screen.getByLabelText('Identificação da viagem')).toHaveTextContent('PVL8973');
    expect(screen.getByLabelText('Identificação da viagem')).toHaveTextContent('1003');
    fireEvent.click(accept);
    await waitFor(() => expect(mocks.updateCargo).toHaveBeenCalledWith(expect.objectContaining({ tripId: ids.trip,
      action: 'accept', payload: { vehicle_id: ids.vehicle } })));
  });

  it.each(['missing', 'wrong-vehicle', 'missing-number'])('blocks acceptance for %s identity without substituting UUIDs', async mode => {
    mocks.getCargo.mockResolvedValue(cargo(false));
    mocks.identityResponse.mockImplementation(async () => ({ data: mode === 'missing' ? null : identityRow(mode === 'wrong-vehicle'
      ? { vehicle_id: ids.other } : { dispatch_trip_loads: [{ load_id: ids.load1, loads: null }] }), error: null }));
    render(view());
    const accept = await screen.findByRole('button', { name: 'Aceitar viagem e veículo' });
    await screen.findByText(/Atualize antes de aceitar/);
    expect(accept).toBeDisabled();
    expect(screen.getByLabelText('Identificação da viagem')).not.toHaveTextContent('73000000');
    expect(mocks.updateCargo).not.toHaveBeenCalled();
  });

  it('blocks acceptance after an identity refresh fails despite a previously successful response, then recovers', async () => {
    mocks.getCargo.mockResolvedValue(cargo(false));
    render(view());
    const accept = await screen.findByRole('button', { name: 'Aceitar viagem e veículo' });
    await waitFor(() => expect(accept).toBeEnabled());
    mocks.identityResponse.mockResolvedValue({ data: null, error: { code: '42501', message: 'QA denied' } });
    await act(async () => { await client.refetchQueries({ queryKey: ['driver_cargo_trip_identity'] }); });
    await waitFor(() => expect(accept).toBeDisabled());
    expect(screen.getByLabelText('Identificação da viagem')).not.toHaveTextContent('PVL8973');
    mocks.identityResponse.mockResolvedValue({ data: identityRow(), error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar identificação' }));
    await waitFor(() => expect(accept).toBeEnabled());
  });

  it.each(['actor', 'tenant', 'driver'] as const)('resets identity and drafts synchronously when %s changes', async key => {
    const rendered = await loadingForm();
    fireEvent.change(screen.getAllByLabelText('Peso kg')[0], { target: { value: '222.22' } });
    mocks.context[key] = ids.other;
    mocks.getCargo.mockResolvedValue(cargo());
    mocks.identityResponse.mockImplementation(async () => ({ data: identityRow({ vehicles: { plate: 'NEW1234' } }), error: null }));
    rendered.rerender(view());
    expect(screen.queryByText(/PVL8973/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Identificação da viagem')).toHaveTextContent('NEW1234'));
    expect(screen.getAllByLabelText('Peso kg')[0]).toHaveValue(7691.73);
  });

  it('does not resurrect a late identity response from the previous actor', async () => {
    let resolveOld: (value: unknown) => void = () => undefined;
    mocks.identityResponse.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const rendered = render(view());
    await waitFor(() => expect(mocks.identityResponse).toHaveBeenCalledTimes(1));
    const oldRow = identityRow({ vehicles: { plate: 'OLD1234' } });
    mocks.context.actor = ids.other;
    mocks.identityResponse.mockImplementation(async () => ({ data: identityRow({ vehicles: { plate: 'NEW1234' } }), error: null }));
    rendered.rerender(view());
    await waitFor(() => expect(screen.getByLabelText('Identificação da viagem')).toHaveTextContent('NEW1234'));
    await act(async () => { resolveOld({ data: oldRow, error: null }); });
    expect(screen.queryByText(/OLD1234/)).not.toBeInTheDocument();
  });

  it('preserves non-custody snapshot fields and saves all operational labels', async () => {
    const prior = { version: 1, tenantId: ids.tenant, actorId: ids.actor, tripId: ids.trip,
      trip: { id: ids.trip, driver: { id: ids.driver, name: 'QA' }, vehicle: { id: ids.vehicle, plate: 'OLD1234' } },
      loads: [], stops: [{ id: 'stop-QA' }], deliveryItemsByStop: { 'stop-QA': [] },
      deliveryFiscalSnapshotsByStop: { 'stop-QA': { revision: 'untouched' } },
      checklist: { pre: { id: null, boundaryId: null, checkedItems: [1] }, post: { id: null, boundaryId: null, checkedItems: [] } },
      journey: { events: [], lastStartId: null, lastEndId: null }, instructions: ['QA'], occurrences: [], documents: [], cargo: null };
    mocks.read.mockResolvedValue(prior);
    await loadingForm();
    await waitFor(() => expect(mocks.put).toHaveBeenCalledWith(expect.objectContaining({
      trip: expect.objectContaining({ vehicle: expect.objectContaining({ plate: 'PVL8973' }) }),
      deliveryFiscalSnapshotsByStop: prior.deliveryFiscalSnapshotsByStop,
    })));
    const saved = mocks.put.mock.calls.at(-1)?.[0];
    expect(saved.loads.map((item: { id: string; loadNumber: string }) => [item.id, item.loadNumber])).toEqual([
      [ids.load1, '1003'], [ids.load2, '1012'],
    ]);
    expect(saved.stops).toEqual(prior.stops);
    expect(saved.checklist).toEqual(prior.checklist);
  });

  it('reopens the same scoped cargo offline with saved labels and rounded weight while mutations remain blocked', async () => {
    const rendered = await loadingForm();
    await waitFor(() => expect(mocks.put).toHaveBeenCalledWith(expect.objectContaining({
      trip: expect.objectContaining({ vehicle: expect.objectContaining({ plate: 'PVL8973' }) }),
    })));
    const saved = mocks.put.mock.calls.at(-1)?.[0];
    rendered.unmount();
    client.clear();
    mocks.context.online = false;
    mocks.read.mockResolvedValue(saved);
    mocks.getCargo.mockRejectedValue(new Error('Offline QA'));
    mocks.identityResponse.mockRejectedValue(new Error('Offline QA'));
    render(view());
    await waitFor(() => expect(screen.getByLabelText('Identificação da viagem')).toHaveTextContent('PVL8973'));
    expect(screen.getByLabelText('Identificação da viagem')).toHaveTextContent('1003');
    expect(screen.getAllByLabelText('Peso kg')[0]).toHaveValue(7691.73);
    expect(screen.getByRole('button', { name: 'Confirmar conferência da carga' })).toBeDisabled();
    expect(mocks.updateCargo).not.toHaveBeenCalled();
  });

  it('does not replace a valid offline identity with a partial online response while identity is pending or fails', async () => {
    const first = await loadingForm();
    await waitFor(() => expect(mocks.put).toHaveBeenCalledWith(expect.objectContaining({
      trip: expect.objectContaining({ vehicle: expect.objectContaining({ plate: 'PVL8973' }) }),
    })));
    const saved = mocks.put.mock.calls.at(-1)?.[0];
    first.unmount();
    client.clear();
    mocks.put.mockClear();
    mocks.read.mockResolvedValue(saved);
    let resolveIdentity: (value: unknown) => void = () => undefined;
    mocks.identityResponse.mockImplementationOnce(() => new Promise(resolve => { resolveIdentity = resolve; }));
    render(view());
    await screen.findByRole('heading', { name: 'Carga e custódia' });
    await waitFor(() => expect(mocks.identityResponse).toHaveBeenCalled());
    expect(mocks.put).not.toHaveBeenCalled();
    await act(async () => { resolveIdentity({ data: null, error: { code: '42501' } }); });
    expect(mocks.put).not.toHaveBeenCalled();
    expect(saved.trip.vehicle.plate).toBe('PVL8973');
    expect(saved.loads[0].loadNumber).toBe('1003');
  });
});
