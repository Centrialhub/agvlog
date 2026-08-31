import { describe, it, expect } from 'vitest';
import { validateRouteConsistency } from '@/lib/route-planning/routeConsistency';
import type { RouteStopDraft } from '@/lib/route-planning/routePlanningTypes';

const baseStop = (over: Partial<RouteStopDraft> = {}): RouteStopDraft => ({
  id: 's1',
  recipient_name: 'Cliente',
  destination: 'Cliente - Belo Horizonte - MG',
  city: 'BH',
  state: 'MG',
  neighborhood: null,
  load_ids: ['L1'],
  fiscal_document_ids: ['FD1'],
  invoice_numbers: ['1'],
  total_weight_kg: 100,
  total_volume_m3: 1,
  total_pallet_count: 1,
  total_value: 100,
  service_time_minutes: 20,
  priority: 0,
  risk_level: 'normal',
  ...over,
});

const baseLoad = (over: any = {}) => ({
  id: 'L1',
  destination: 'BH',
  items: [{ fiscal_document_id: 'FD1' }],
  total_pallet_count: 1,
  total_weight_kg: 100,
  total_volume_m3: 1,
  ...over,
});

describe('validateRouteConsistency', () => {
  it('rota pronta sem warnings é válida', () => {
    const r = validateRouteConsistency({
      loads: [baseLoad()],
      stops: [baseStop()],
      vehicle_id: 'V1',
      driver_id: 'D1',
      planned_start_at: '2030-01-01T08:00',
    });
    expect(r.valid).toBe(true);
    expect(r.blockingErrors).toEqual([]);
  });

  it('bloqueia se dirty', () => {
    const r = validateRouteConsistency({
      loads: [baseLoad()],
      stops: [baseStop()],
      vehicle_id: 'V1', driver_id: 'D1', planned_start_at: '2030-01-01T08:00',
      dirty: true,
    });
    expect(r.valid).toBe(false);
    expect(r.blockingErrors[0]).toMatch(/Recalcule/);
  });

  it('bloqueia se parada referencia carga removida', () => {
    const r = validateRouteConsistency({
      loads: [baseLoad({ id: 'L2', items: [] })],
      stops: [baseStop({ load_ids: ['L1'] })],
      vehicle_id: 'V1', driver_id: 'D1', planned_start_at: 'x',
    });
    expect(r.valid).toBe(false);
    expect(r.blockingErrors.join(' ')).toMatch(/carga removida/);
  });

  it('bloqueia se FD aparece em duas paradas', () => {
    const r = validateRouteConsistency({
      loads: [baseLoad()],
      stops: [
        baseStop({ id: 's1', fiscal_document_ids: ['FD1'] }),
        baseStop({ id: 's2', fiscal_document_ids: ['FD1'] }),
      ],
      vehicle_id: 'V1', driver_id: 'D1', planned_start_at: 'x',
    });
    expect(r.blockingErrors.join(' ')).toMatch(/2 paradas diferentes/);
  });

  it('bloqueia se carga não aparece em nenhuma parada', () => {
    const r = validateRouteConsistency({
      loads: [baseLoad(), baseLoad({ id: 'L2', items: [{ fiscal_document_id: 'FD2' }] })],
      stops: [baseStop()],
      vehicle_id: 'V1', driver_id: 'D1', planned_start_at: 'x',
    });
    expect(r.blockingErrors.join(' ')).toMatch(/não aparece em nenhuma parada/);
  });

  it('bloqueia veículo duplicado em outra rota', () => {
    const r = validateRouteConsistency(
      { loads: [baseLoad()], stops: [baseStop()], vehicle_id: 'V1', driver_id: 'D1', planned_start_at: 'x' },
      { otherRoutes: [{ id: 'r2', vehicle_id: 'V1', driver_id: 'D2', name: 'Outra' }], routeId: 'r1' },
    );
    expect(r.blockingErrors.join(' ')).toMatch(/Veículo já alocado/);
  });

  it('warning para excesso de paletes', () => {
    const r = validateRouteConsistency(
      { loads: [baseLoad({ total_pallet_count: 30 })], stops: [baseStop()], vehicle_id: 'V1', driver_id: 'D1', planned_start_at: 'x' },
      { vehicles: [{ id: 'V1', max_pallets: 20 }] },
    );
    expect(r.warnings.join(' ')).toMatch(/excedem/);
    expect(r.valid).toBe(true);
  });
  it('bloqueia documento omitido mesmo se sua carga aparece na parada',()=>{
    const result=validateRouteConsistency({loads:[baseLoad({items:[{fiscal_document_id:'FD1'},{fiscal_document_id:'FD2'}]})],
      stops:[baseStop()],vehicle_id:'V1',driver_id:'D1',planned_start_at:'2030-01-01T08:00'});
    expect(result.valid).toBe(false);expect(result.blockingErrors.join(' ')).toContain('NF-e FD2… não aparece');
  });
  it('bloqueia parada extra sem documentos',()=>{
    const result=validateRouteConsistency({loads:[baseLoad()],stops:[baseStop(),baseStop({id:'s2',fiscal_document_ids:[]})],
      vehicle_id:'V1',driver_id:'D1',planned_start_at:'2030-01-01T08:00'});
    expect(result.valid).toBe(false);expect(result.blockingErrors.join(' ')).toContain('distribua os documentos');
  });
  it('bloqueia o documento certo associado à carga errada na parada',()=>{
    const result=validateRouteConsistency({loads:[baseLoad(),baseLoad({id:'L2',items:[{fiscal_document_id:'FD2'}]})],
      stops:[baseStop({load_ids:['L2']}),baseStop({id:'s2',load_ids:['L1'],fiscal_document_ids:['FD2']})],
      vehicle_id:'V1',driver_id:'D1',planned_start_at:'2030-01-01T08:00'});
    expect(result.valid).toBe(false);expect(result.blockingErrors.join(' ')).toContain('cargas não correspondem');
  });
  it('aceita distribuição completa de uma carga em duas paradas',()=>{
    const result=validateRouteConsistency({loads:[baseLoad({items:[{fiscal_document_id:'FD1'},{fiscal_document_id:'FD2'}]})],
      stops:[baseStop(),baseStop({id:'s2',fiscal_document_ids:['FD2']})],vehicle_id:'V1',driver_id:'D1',planned_start_at:'2030-01-01T08:00'});
    expect(result.valid).toBe(true);
  });
  it('expõe a pendência de baixa de itens manuais em vez de descartá-los da rota',()=>{
    const result=validateRouteConsistency({loads:[baseLoad({items:[{fiscal_document_id:'FD1'},{fiscal_document_id:null}]})],
      stops:[baseStop()],vehicle_id:'V1',driver_id:'D1',planned_start_at:'2030-01-01T08:00'});
    expect(result.valid).toBe(false);expect(result.blockingErrors.join(' ')).toContain('itens manuais');
  });
});
