import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StopDraftTable from '@/components/route-planning/StopDraftTable';
import { regenerateStopsPreservingEdits } from '@/lib/route-planning/regenerateStops';
import type { RouteStopDraft } from '@/lib/route-planning/routePlanningTypes';

const stop = (overrides: Partial<RouteStopDraft> = {}): RouteStopDraft => ({
  id: 'stop-1', client_id: 'client-1', recipient_name: 'Cliente QA', destination: 'Cliente QA - Montes Claros - MG',
  city: 'Montes Claros', state: 'MG', neighborhood: 'Centro', load_ids: ['load-1'],
  fiscal_document_ids: ['doc-1'], invoice_numbers: ['1'], total_weight_kg: 10,
  total_volume_m3: 1, total_pallet_count: 1, total_value: 100, service_time_minutes: 20,
  priority: 0, risk_level: 'normal', ...overrides,
});

afterEach(cleanup);

describe('planned stop coordinates in the operator UI', () => {
  it('propagates the exact manually entered latitude and longitude without geocoding', () => {
    const onUpdate = vi.fn();
    render(<StopDraftTable stops={[stop()]} onMove={vi.fn()} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByLabelText('Latitude parada 1'), { target: { value: '-16.7282' } });
    fireEvent.change(screen.getByLabelText('Longitude parada 1'), { target: { value: '-43.8578' } });
    expect(onUpdate).toHaveBeenNthCalledWith(1, 'stop-1', { latitude: -16.7282 });
    expect(onUpdate).toHaveBeenNthCalledWith(2, 'stop-1', { longitude: -43.8578 });
  });

  it('clears an entered coordinate instead of substituting zero or a centroid', () => {
    const onUpdate = vi.fn();
    render(<StopDraftTable stops={[stop({ latitude: -16.7, longitude: -43.8 })]} onMove={vi.fn()} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByLabelText('Latitude parada 1'), { target: { value: '' } });
    expect(onUpdate).toHaveBeenCalledWith('stop-1', { latitude: null });
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
