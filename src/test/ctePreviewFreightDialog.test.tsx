import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CteGroupPreview } from '@/lib/cteGroupingModes';
const state = vi.hoisted(() => ({ calculate: vi.fn(), rpc: vi.fn(), clients: [{ id: 'client-a', tax_id: '', company_name: 'Cliente' }],
  empty: [], tenant: { id: 'tenant-a' }, toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: state.tenant }) }));
vi.mock('@/hooks/useEmitters', () => ({ useEmitters: () => ({ data: state.empty, isLoading: false }), useHubCredentials: () => ({ data: state.empty }) }));
vi.mock('@/hooks/useVehicles', () => ({ useVehicles: () => ({ data: state.empty }) }));
vi.mock('@/hooks/useDrivers', () => ({ useDrivers: () => ({ data: state.empty }) }));
vi.mock('@/hooks/useClients', () => ({ useClients: () => ({ data: state.clients, isLoading: false }) }));
vi.mock('@/hooks/useIssueCTe', () => ({ useIssueCTe: () => ({ mutateAsync: vi.fn() }) }));
vi.mock('@/hooks/useInsuranceProfile', () => ({ useInsuranceProfile: () => ({}), useUpdateInsuranceProfile: () => ({ mutateAsync: vi.fn() }) }));
vi.mock('@/hooks/useSonnerToast', () => ({ useSonnerToast: () => state.toast }));
vi.mock('@/hooks/useFreightCalculator', () => ({ calculateFreight: state.calculate }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: state.rpc } }));
// Address registry and fiscal provider are separate from this UI regression.
vi.mock('@/lib/fiscal/cteAddressAutocomplete', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/fiscal/cteAddressAutocomplete')>(),
  needsCtePartyRegistryEnrichment: () => false,
}));
import { CteEmissionPreviewDialog } from '@/components/billing/CteEmissionPreviewDialog';

const groups = [{ key: 'group-a', remitter: 'Remetente', recipient: 'Destino', recipient_city: 'Pirapora',
  recipient_state: 'MG', client_id: 'client-a', freight_value: 0, cargo_value: 1000,
  weight_kg: 50, pallet_count: 2, invoice_count: 1, load_ids: [], fiscal_document_ids: ['nf-a'],
  documents: [{ id: 'nf-a', tenant_id: 'tenant-a', client_id: 'client-a', freight_value: null,
    recipient: 'Destino', recipient_city: 'Pirapora', recipient_state: 'MG', value: 1000,
    weight_kg: 50, pallet_count: 2, invoice_number: '1', access_key: '3'.repeat(44) }],
}] as unknown as CteGroupPreview[];

async function openValues() {
  const tab = await screen.findByRole('tab', { name: 'Carga & valores' });
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
  fireEvent.click(tab);
  return screen.findByRole('textbox', { name: 'Frete peso — frete base (R$)' });
}
beforeEach(() => { state.calculate.mockReset(); state.rpc.mockReset().mockResolvedValue({ data: {}, error: null }); });
afterEach(cleanup);
describe('prévia CT-e montada: frete automático e edição durante carregamento', () => {
  it('preenche o campo real quando a NF ainda não tem frete salvo', async () => {
    state.calculate.mockResolvedValue({ success: true, value: 1234.56 });
    render(<CteEmissionPreviewDialog open onOpenChange={() => {}} groups={groups} />);
    const input = await openValues();
    await waitFor(() => expect(input).toHaveValue('1234,56'));
  });
  it.each(['987,65', ''])('preserva a entrada manual %s quando o cálculo atrasado termina', async (value) => {
    let finish!: (value: unknown) => void;
    state.calculate.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<CteEmissionPreviewDialog open onOpenChange={() => {}} groups={groups} />);
    const input = await openValues();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value } });
    await act(async () => { finish({ success: true, value: 500 }); });
    expect(input).toHaveValue(value);
    fireEvent.blur(input);
    await waitFor(() => expect(input).toHaveValue(value ? value : '0,00'));
  });
  it('mostra falha do cálculo sem preencher uma soma parcial', async () => {
    state.calculate.mockResolvedValue({ success: false, value: 0, error: 'Sem tabela compatível' });
    render(<CteEmissionPreviewDialog open onOpenChange={() => {}} groups={groups} />);
    const input = await openValues();
    await screen.findByText(/Frete automático incompleto: Sem tabela compatível/);
    expect(input).toHaveValue('0,00');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '250,50' } });
    expect(screen.queryByText(/Frete automático incompleto:/)).not.toBeInTheDocument();
  });
  it('repetir consulta dos padrões não apaga o frete manual', async () => {
    state.calculate.mockResolvedValue({ success: true, value: 500 });
    state.rpc.mockResolvedValueOnce({ data: null, error: new Error('Falha nos padrões') });
    const withLoad = [{ ...groups[0], load_ids: ['load-a'] }];
    render(<CteEmissionPreviewDialog open onOpenChange={() => {}} groups={withLoad} />);
    const input = await openValues();
    await screen.findByText(/Não foi possível carregar os padrões do grupo/);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '987,65' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/Não foi possível carregar os padrões do grupo/)).not.toBeInTheDocument());
    expect(input).toHaveValue('987,65');
  });
});
