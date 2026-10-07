import { useRef, useState } from 'react';
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DriverDeliveryDetailSheet } from '@/components/driver/deliveries/DriverDeliveryDetailSheet';
import { DriverDeliveryEventCatalogSheet } from '@/components/driver/deliveries/DriverDeliveryEventCatalogSheet';
import { DriverDeliveryEventFormSheet } from '@/components/driver/deliveries/DriverDeliveryEventFormSheet';
import { getDriverDeliveryEvent, type DriverStop } from '@/components/driver/deliveries/driverDeliveryEvents';
import { useDriverDeliverySelection } from '@/hooks/useDriverDeliverySelection';
import { useDriverDeliveryEventDraft } from '@/hooks/useDriverDeliveryEventDraft';
import { baselineReceiptScanQualityPolicy } from '@/lib/driver/receiptQualityPolicy';

const stop: DriverStop = {
  id: 'stop', tenant_id: 'tenant', dispatch_trip_id: 'trip', status: 'arrived',
  client_id: null, created_at: '2026-10-06T10:00:00Z', updated_at: '2026-10-06T10:00:00Z',
  delivery_window_end: null, delivery_window_start: null, estimated_departure_at: null,
  latitude: null, longitude: null, risk_level: null, risk_reason: null, service_time_minutes: null, stop_order: 1,
  destination: 'Rua de teste', actual_arrival_at: '2026-10-06T10:00:00Z',
  actual_departure_at: null, planned_arrival_at: null, notes: null,
  dispatch_stop_documents: [], clients: { company_name: 'Cliente de teste', phone: null, mobile: null, email: null },
};
type Kind = 'detail' | 'catalog' | 'form';
function Harness({ kind }: { kind: Kind }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const draft = useDriverDeliveryEventDraft();
  const common = { onClose: () => setOpen(false), onCloseAutoFocus: (event: Event) => {
    event.preventDefault(); opener.current?.focus();
  } };
  return <>
    <button ref={opener} onClick={() => setOpen(true)}>Abrir entrega</button>
    {kind === 'detail' && <DriverDeliveryDetailSheet stop={open ? stop : null} {...common} onOpenCatalog={vi.fn()} onSelectEvent={vi.fn()} />}
    {kind === 'catalog' && <DriverDeliveryEventCatalogSheet stop={open ? stop : null} {...common} onSelect={vi.fn()} />}
    {kind === 'form' && <DriverDeliveryEventFormSheet selection={open ? { stop, eventKey: 'outros' } : null}
      {...common} definition={getDriverDeliveryEvent('outros')} draft={draft} currentStop={stop}
      allProducts={[]} products={[]} productsLoading={false} productsError={null} refetchProducts={vi.fn()}
      totalReturnValue={0} totalReturnedQuantity={0} totalProductQuantity={0} mappedOutcome={undefined} reason=""
      canSubmit={false} submissionLocked={false} submitting={false}
      receiptQualityPolicy={baselineReceiptScanQualityPolicy('tenant', null)} receiptQualityPolicyLoading={false}
      receiptQualityPolicyError={null} refetchReceiptQualityPolicy={vi.fn()} onSubmit={vi.fn()} notify={vi.fn()} />}
  </>;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('real delivery sheets accessibility', () => {
  it.each([
    ['detail', 'Entrega', 'Consulte o cliente, o documento, a saída e o status atual desta entrega.'],
    ['catalog', 'Listagem de eventos', 'Escolha um evento para a entrega selecionada.'],
    ['form', 'Dados do evento', 'Preencha os dados e comprovantes do evento da entrega selecionada.'],
  ] as const)('resolves the %s description and keeps keyboard focus inside until dismissal', async (kind, name, description) => {
    const warn = vi.spyOn(console, 'warn'); const error = vi.spyOn(console, 'error');
    const user = userEvent.setup(); render(<Harness kind={kind} />);
    const opener = screen.getByRole('button', { name: 'Abrir entrega' });
    opener.focus(); await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name });
    const ids = dialog.getAttribute('aria-describedby')?.split(/\s+/);
    expect(ids?.length).toBeGreaterThan(0);
    for (const id of ids ?? []) expect(document.getElementById(id)).toHaveTextContent(description);
    expect(dialog).toHaveAccessibleDescription(description);
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    for (const shift of [false, true]) for (let index = 0; index < 16; index++) {
      await user.tab({ shift });
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    await user.keyboard('{Enter}'); await screen.findByRole('dialog', { name });
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/Missing.*Description|aria-describedby/);
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/requires.*Title|aria-describedby/);
  });
});

it('rechecks the current trip before dispatch after an asynchronous prerequisite', () => {
  const { result, rerender } = renderHook(({ tripStarted }) => useDriverDeliverySelection({
    scope: ['tenant', 'actor', 'driver', 'trip'], stops: [stop], pendingStopIds: new Set(),
    refreshing: false, error: false, authoritative: true, tripStarted,
  }), { initialProps: { tripStarted: true } });
  const context = result.current.context;
  expect(result.current.assertCurrentStop(context, stop.id, false)).toEqual(stop);
  rerender({ tripStarted: false });
  expect(() => result.current.assertCurrentStop(context, stop.id, false)).toThrow('Atualize a viagem');
  // An already dispatched, immutable attempt can still reconcile its acknowledgement.
  expect(result.current.assertCurrentStop(context, stop.id, true)).toEqual(stop);
});
