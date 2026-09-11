import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StopDraftTable from '@/components/route-planning/StopDraftTable';
import { regenerateStopsPreservingEdits } from '@/lib/route-planning/regenerateStops';
import type { RouteStopDraft } from '@/lib/route-planning/routePlanningTypes';

vi.mock('@/components/maps/LocationPicker', () => ({
  LocationPicker: ({ onChange }: { onChange: (value: unknown) => void }) => <div>
    <button onClick={() => onChange({ latitude: -16.7282, longitude: -43.8578, source: 'address_geocoded',
      address: 'Rua QA, 10, Montes Claros - MG', provider: 'qa', accuracy_m: 50, confidence: 0.9,
      audit: { selected_label: 'Rua QA' } })}>Escolher endereço QA</button>
    <button onClick={() => onChange({ latitude: -16.7, longitude: -43.8, source: 'map_selected',
      address: null, provider: 'leaflet_map', accuracy_m: null, confidence: 1, audit: { selected_interactively: true } })}>
      Escolher ponto no mapa
    </button>
  </div>,
}));

const stop = (overrides: Partial<RouteStopDraft> = {}): RouteStopDraft => ({
  id: 'stop-1', client_id: 'client-1', recipient_name: 'Cliente QA', destination: 'Cliente QA - Montes Claros - MG',
  city: 'Montes Claros', state: 'MG', neighborhood: 'Centro', load_ids: ['load-1'],
  fiscal_document_ids: ['doc-1'], invoice_numbers: ['1'], total_weight_kg: 10,
  total_volume_m3: 1, total_pallet_count: 1, total_value: 100, service_time_minutes: 20,
  priority: 0, risk_level: 'normal', ...overrides,
});

afterEach(cleanup);

describe('planned stop coordinates in the operator UI', () => {
  it('uses an address result instead of exposing manual latitude and longitude', () => {
    const onUpdate = vi.fn();
    render(<StopDraftTable tenantId="tenant" stops={[stop()]} onMove={vi.fn()} onUpdate={onUpdate} />);
    expect(screen.queryByLabelText(/Latitude/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Definir por endereço\/mapa/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Escolher endereço QA' }));
    fireEvent.click(screen.getByRole('button', { name: 'Usar este local' }));
    expect(onUpdate).toHaveBeenCalledWith('stop-1', expect.objectContaining({
      latitude: -16.7282, longitude: -43.8578, location_source: 'address_geocoded',
      location_address: 'Rua QA, 10, Montes Claros - MG', location_provider: 'qa',
    }));
  });

  it('allows correcting a legacy coordinate through a point selected on the map', () => {
    const onUpdate = vi.fn();
    render(<StopDraftTable tenantId="tenant" stops={[stop({ latitude: -16.7, longitude: -43.8 })]} onMove={vi.fn()} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole('button', { name: /Revisar endereço\/mapa/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Escolher ponto no mapa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Usar este local' }));
    expect(onUpdate).toHaveBeenCalledWith('stop-1', expect.objectContaining({ location_source: 'map_selected' }));
  });

  it('preserves verified coordinates when loads are regenerated or reordered', () => {
    const regenerated = regenerateStopsPreservingEdits([{
      id: 'load-1', load_number: '1001', destination: 'Montes Claros', items: [{
        id: 'item-1', load_id: 'load-1', pallet_count: 1, weight_kg: 10, volume_m3: 1,
        fiscal_document_id: 'doc-1', fiscal_documents: {
          invoice_number: '1', recipient: 'Cliente QA', recipient_city: 'Montes Claros',
          recipient_state: 'MG', recipient_neighborhood: 'Centro', client_id: 'client-1', value: 100, weight_kg: 10,
        },
      }],
    }], [stop({ latitude: -16.7282, longitude: -43.8578, manual_order: 1 })], 'manual');
    expect(regenerated[0]).toMatchObject({ latitude: -16.7282, longitude: -43.8578, manual_order: 1 });
  });
});
