import { describe, expect, it } from 'vitest';
import { averagePalletsPerTrip, deliverySuccessRate } from '@/lib/reports/productivityMetrics';

describe('média de paletes por viagem', () => {
  it('soma as cargas da mesma viagem antes de calcular a média', () => {
    expect(averagePalletsPerTrip([
      { id: 'load-1', trip_id: 'trip-1', total_pallet_count: 10 },
      { id: 'load-2', trip_id: 'trip-1', total_pallet_count: 8 },
      { id: 'load-3', trip_id: 'trip-2', total_pallet_count: 12 },
    ])).toBe(15);
  });

  it('trata uma carga sem viagem como uma viagem independente', () => {
    expect(averagePalletsPerTrip([
      { id: 'load-1', trip_id: null, total_pallet_count: 6 },
      { id: 'load-2', trip_id: null, total_pallet_count: 10 },
    ])).toBe(8);
  });
});

describe('taxa de sucesso de entrega', () => {
  it('inclui todos os desfechos terminais malsucedidos no denominador', () => {
    expect(deliverySuccessRate([
      { status: 'delivered' },
      { status: 'divergent' },
      { status: 'partial_delivery' },
      { status: 'returned' },
      { status: 'refused' },
      { status: 'failed' },
    ])).toBe(17);
  });

  it('não inventa sucesso quando não há desfecho de entrega', () => {
    expect(deliverySuccessRate([{ status: 'in_transit' }, { status: 'cancelled' }])).toBeNull();
  });
});
