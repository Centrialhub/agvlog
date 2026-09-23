import{describe,expect,it}from'vitest';import{parseRoutePlanSnapshot}from'@/lib/route-planning/routePlanSnapshot';
describe('route plan snapshot boundary',()=>{
 it('rejects malformed stops without leaking them into rendering',()=>{const result=parseRoutePlanSnapshot({load_ids:['load'],stops:[{id:'broken'}]} as never);expect(result).toEqual({snapshot:{load_ids:['load']},valid:false});});
 it('accepts a structurally complete stop',()=>{const stop={id:'stop',recipient_name:'Cliente',destination:'Rua',load_ids:['load'],fiscal_document_ids:[],invoice_numbers:[],total_weight_kg:1,total_volume_m3:1,total_pallet_count:1,total_value:1,service_time_minutes:20,priority:0,risk_level:'normal'};const result=parseRoutePlanSnapshot({stops:[stop]} as never);expect(result.valid).toBe(true);expect(result.snapshot.stops).toEqual([expect.objectContaining(stop)]);});
 it('marks non-finite timing inputs as invalid',()=>{expect(parseRoutePlanSnapshot({initial_transit_minutes:Infinity} as never)).toEqual({snapshot:{},valid:false});});
});
