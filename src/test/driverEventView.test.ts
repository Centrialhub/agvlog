import { describe, expect, it } from 'vitest';

import type { Tables } from '@/integrations/supabase/types';
import { mapOperationalEventToDriverEvent } from '@/lib/driver/driverEventView';

function event(overrides: Partial<Tables<'operational_events'>> = {}): Tables<'operational_events'> {
  return {
    id: 'event-1',
    tenant_id: 'tenant-1',
    load_id: null,
    order_id: null,
    vehicle_id: null,
    driver_id: 'driver-1',
    client_id: null,
    event_type: 'delivered',
    severity: 'medium',
    description: 'Entrega concluída',
    financial_impact: 0,
    resolution: null,
    resolved_at: null,
    created_by: null,
    created_at: '2026-08-25T12:00:00Z',
    updated_at: '2026-08-25T12:00:00Z',
    report_details: null,
    visible_to_client: false,
    client_action_required: false,
    client_opened: false,
    public_status: 'open',
    client_resolution_note: null,
    dispatch_trip_id: null,
    dispatch_stop_id: null,
    fiscal_document_id: null,
    proof_of_delivery_id: null,
    idempotency_key: null,
    payload: {},
    ...overrides,
  };
}

describe('mapOperationalEventToDriverEvent', () => {
  it('maps typed report details used by both driver event screens', () => {
    const mapped = mapOperationalEventToDriverEvent(event({
      report_details: {
        label: 'Entregue ao cliente',
        stop_name: 'Loja Central',
        invoice: 12345,
        receiver_name: 'Maria',
        has_photo: true,
        has_signature: true,
      },
    }));

    expect(mapped).toMatchObject({
      type: 'finalizador',
      label: 'Entregue ao cliente',
      stopName: 'Loja Central',
      invoice: '12345',
      receiver: 'Maria',
      hasPhoto: true,
      hasSignature: true,
    });
  });

  it('ignores malformed JSON details and keeps safe fallbacks', () => {
    const mapped = mapOperationalEventToDriverEvent(event({
      event_type: 'arrival',
      report_details: ['unexpected'],
    }));

    expect(mapped.type).toBe('informativo');
    expect(mapped.label).toBe('arrival');
    expect(mapped.stopName).toBe('—');
    expect(mapped.hasPhoto).toBe(false);
  });
});
