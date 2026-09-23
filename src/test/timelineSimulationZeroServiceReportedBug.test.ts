import { describe, expect, it } from 'vitest';
import { simulateStopTimeline } from '@/lib/route-planning/timelineSimulation';
import type { RouteStopDraft } from '@/lib/route-planning/routePlanningTypes';

const stop = (serviceTime: number): RouteStopDraft => ({
  id: 'stop-1',
  recipient_name: 'Cliente',
  destination: 'Destino',
  city: 'Belo Horizonte',
  state: 'MG',
  neighborhood: null,
  load_ids: ['load-1'],
  fiscal_document_ids: ['document-1'],
  invoice_numbers: ['1'],
  total_weight_kg: 1,
  total_volume_m3: 1,
  total_pallet_count: 1,
  total_value: 1,
  latitude: -19.9,
  longitude: -43.9,
  service_time_minutes: serviceTime,
  priority: 0,
  risk_level: 'normal',
});

describe('simulação do tempo de serviço', () => {
  it('preserva zero como duração legítima da parada', () => {
    const [result] = simulateStopTimeline([stop(0)], '2026-09-21T08:00:00.000Z');

    expect(result.planned_arrival_at).toBe('2026-09-21T08:00:00.000Z');
    expect(result.estimated_departure_at).toBe('2026-09-21T08:00:00.000Z');
  });

  it('continua usando 20 minutos para um valor não numérico legado', () => {
    const invalid = { ...stop(10), service_time_minutes: Number.NaN };
    const [result] = simulateStopTimeline([invalid], '2026-09-21T08:00:00.000Z');

    expect(result.estimated_departure_at).toBe('2026-09-21T08:20:00.000Z');
  });

  it('não deixa valores infinitos criarem uma data inválida',()=>{
    const [result]=simulateStopTimeline([{...stop(10),service_time_minutes:Infinity}],'2026-09-21T08:00:00.000Z',{initialTransitMinutes:Infinity});
    expect(result.planned_arrival_at).toBe('2026-09-21T08:00:00.000Z');
    expect(result.estimated_departure_at).toBe('2026-09-21T08:20:00.000Z');
  });
});
