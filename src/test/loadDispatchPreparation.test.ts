import {beforeEach,it,expect,vi} from 'vitest';
import type {LoadItem} from '@/hooks/useLoadItems';
import type {RoutePlanningDraft} from '@/hooks/useRoutePlanningDrafts';
import type {RouteStopDraft} from '@/lib/route-planning/routePlanningTypes';
import {prepareLoadDispatch,savedLoadDispatchPlan,resolveAutomaticStopLocations,assertLoadDispatchDraftCurrent} from '@/lib/route-planning/loadDispatchPreparation';
const m=vi.hoisted(()=>({drafts:[] as unknown[],docs:[] as unknown[],clients:[] as unknown[],filters:vi.fn(),search:vi.fn(),version:{updated_at:'v1',status:'draft'},error:null as Error|null}));
vi.mock('@/lib/geocoding',async(importActual)=>({...await importActual<object>(),geocodeAddress:m.search}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 from:(table:string)=>{const q={select:()=>q,contains:()=>q,eq:(...args:unknown[])=>{m.filters(table,...args);return q;},is:()=>q,in:()=>q,order:()=>q,range:()=>q,abortSignal:()=>q,
  maybeSingle:async()=>({data:m.version,error:m.error}),
  then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:table==='route_planning_drafts'?m.drafts:m.docs,error:m.error}).then(resolve)};return q;},
 rpc:()=>({abortSignal:async()=>({data:m.clients,error:m.error})}),
}}));
const stop=(id='s1',doc='d1'):RouteStopDraft=>({id,recipient_name:id,destination:id,load_ids:['load'],fiscal_document_ids:[doc],invoice_numbers:[],
 total_weight_kg:10,total_volume_m3:1,total_pallet_count:1,total_value:50,service_time_minutes:25,priority:0,risk_level:'normal',
 client_id:'c1',location_address:'Rua QA, 10, Cidade - MG',latitude:-16,longitude:-44,location_source:'map_selected'});
const draft=(stops=[stop()]):RoutePlanningDraft=>({id:'draft',tenant_id:'tenant',status:'draft',name:'Rota salva',load_ids:['load'],updated_at:'v1',driver_id:'driver',vehicle_id:'vehicle',
 planned_start_at:'2030-01-01T10:00:00Z',route_config:{stops}} as unknown as RoutePlanningDraft);
const candidate={label:'Rua QA 10',latitude:-16,longitude:-44,confidence:0.95,accuracy_m:20,bounds:null,provider:'qa',provider_type:'house'};
beforeEach(()=>{vi.clearAllMocks();m.drafts=[];m.error=null;m.version={updated_at:'v1',status:'draft'};m.search.mockResolvedValue([candidate]);
 m.docs=[{id:'d1',invoice_number:'101',recipient:'B',recipient_city:'B',recipient_state:'MG',client_id:'c1',supplier_id:'supplier',value:50,weight_kg:10},
  {id:'d2',invoice_number:'102',recipient:'A',recipient_city:'A',recipient_state:'MG',client_id:'c2',supplier_id:'supplier',value:60,weight_kg:20}];
 m.clients=['c1','c2'].map(id=>({id,address_street:'Rua QA',address_number:'10',address_city:'Cidade',address_state:'MG',address_geocode_status:'pending'}));
});
it('preserva sequência manual, locais, horários, notas e identificação do planejamento salvo',()=>{
 const a={...stop(),manual_order:2,notes:'Portaria',planned_arrival_at:'2030-01-01T12:00:00Z',delivery_window_start:'08:00',service_time_minutes:45};
 const b={...stop('s2','d2'),manual_order:1};
 const result=savedLoadDispatchPlan([draft([a,b])],'tenant','load',['d1','d2'])!;
 expect(result).toMatchObject({draftId:'draft',driverId:'driver',vehicleId:'vehicle',plannedStart:'2030-01-01T10:00:00Z'});
 expect(result.stops).toMatchObject([b,a]);
});
it('não divide rota com múltiplas cargas nem escolhe arbitrariamente entre dois planos',()=>{
 expect(()=>savedLoadDispatchPlan([{...draft(),load_ids:['load','another']}],'tenant','load',['d1'])).toThrow('outras cargas');
 expect(()=>savedLoadDispatchPlan([draft(),{...draft(),id:'other'}],'tenant','load',['d1'])).toThrow('mais de um');
});
it('não usa planos de outra empresa, já despachados, incompletos ou com notas repetidas',()=>{
 expect(savedLoadDispatchPlan([{...draft(),tenant_id:'other'},{...draft(),status:'dispatched'}],'tenant','load',['d1'])).toBeNull();
 expect(()=>savedLoadDispatchPlan([draft()],'tenant','load',['d1','d2'])).toThrow('composição');
 expect(()=>savedLoadDispatchPlan([draft([stop(),stop('duplicate')])],'tenant','load',['d1','d2'])).toThrow('composição');
});
const items=[{id:'i1',load_id:'load',fiscal_document_id:'d1',pallet_count:1,weight_kg:10,volume_m3:1},
 {id:'i2',load_id:'load',fiscal_document_id:'d2',pallet_count:1,weight_kg:20,volume_m3:1}] as LoadItem[];
it('sem rascunho gera paradas por destinatário, ordena e distribui todas as notas automaticamente',async()=>{
 const plan=await prepareLoadDispatch('tenant',{id:'load',load_number:'1',destination:'Nome da rota'},items,new AbortController().signal);
 expect(plan.stops.map(s=>s.fiscal_document_ids)).toEqual([['d2'],['d1']]);
 expect(plan.stops.every(s=>s.latitude===-16&&s.location_source==='address_geocoded')).toBe(true);
 expect(m.search).toHaveBeenCalledTimes(1);expect(m.filters).toHaveBeenCalledWith('fiscal_documents','tenant_id','tenant');
});
it('publica todas as vinculações antes de aguardar a consulta lenta de endereços',async()=>{
 let finish!:(value:unknown)=>void;
 const prepared=vi.fn();m.search.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=prepareLoadDispatch('tenant',{id:'load',load_number:'1',destination:'Rota'},items,new AbortController().signal,prepared);
 await vi.waitFor(()=>expect(prepared).toHaveBeenCalledOnce());
 expect(prepared.mock.calls[0][0].stops.flatMap((s:RouteStopDraft)=>s.fiscal_document_ids).sort()).toEqual(['d1','d2']);
 expect(prepared.mock.calls[0][0].stops.every((s:RouteStopDraft)=>s.location_address?.includes('Rua QA'))).toBe(true);
 finish([candidate]);await pending;
});
it('interrompe a busca após falha do serviço e preserva as notas e endereços para conferência',async()=>{
 m.search.mockRejectedValueOnce(new Error('provider unavailable'));
 const plan=await prepareLoadDispatch('tenant',{id:'load',load_number:'1',destination:'Rota'},items,new AbortController().signal);
 expect(plan.stops.flatMap(s=>s.fiscal_document_ids).sort()).toEqual(['d1','d2']);
 expect(plan.locationWarning).toContain('As notas continuam distribuídas');expect(m.search).toHaveBeenCalledTimes(1);
 expect(plan.stops.every(s=>s.location_exception_reason===undefined)).toBe(true);
});
it('respeita consultas sequenciais e cancelamento durante a espera entre endereços',async()=>{
 vi.useFakeTimers();try{
 const controller=new AbortController(),search=vi.fn().mockResolvedValue([candidate]);
 const stops=[{...stop(),latitude:null,location_address:'Rua QA 1'},
  {...stop('s2','d2'),latitude:null,location_address:'Rua QA 2'}];
 const pending=resolveAutomaticStopLocations(stops,controller.signal,new Set(['c1']),search,'tenant');
 const rejection=expect(pending).rejects.toThrow();
 await vi.advanceTimersByTimeAsync(1000);expect(search).toHaveBeenCalledTimes(1);
 controller.abort();await rejection;expect(search).toHaveBeenCalledTimes(1);
 }finally{vi.useRealTimers();}
});
it('reutiliza localização verificada sem consulta externa',async()=>{
 m.clients=[{id:'c1',address_geocode_status:'verified',address_lat:-16,address_lng:-44,address_geocode_hash:'hash'}];
 const plan=await prepareLoadDispatch('tenant',{id:'load',load_number:'1',destination:null},items.slice(0,1),new AbortController().signal);
 expect(plan.stops[0]).toMatchObject({latitude:-16,longitude:-44,location_audit:{selection:'reused_verified_client'}});expect(m.search).not.toHaveBeenCalled();
});
it('endereço ambíguo, impreciso ou serviço indisponível permanece pendente sem inventar exceção',async()=>{
 const stops=[{...stop(),latitude:null,longitude:null}];
 for(const candidates of [[candidate,{...candidate,longitude:-45}],[{...candidate,accuracy_m:1000}],[]]){
  m.search.mockResolvedValueOnce(candidates);
  const result=await resolveAutomaticStopLocations(stops,new AbortController().signal,new Set(['c1']),m.search,'tenant');
  expect(result[0].latitude).toBeNull();expect(result[0].location_exception_reason).toBeUndefined();
 }
 m.search.mockRejectedValueOnce(new Error('offline'));
 expect((await resolveAutomaticStopLocations(stops,new AbortController().signal,new Set(['c1']),m.search,'tenant'))[0].latitude).toBeNull();
});
it('cancelamento impede novas pesquisas e não devolve coordenadas de uma preparação antiga',async()=>{
 const controller=new AbortController();m.search.mockImplementationOnce(async()=>{controller.abort();return [candidate];});
 await expect(resolveAutomaticStopLocations([{...stop(),latitude:null}],controller.signal,new Set(['c1']),m.search,'tenant')).rejects.toThrow();
});
it('bloqueia preparação sem nota disponível e rascunho alterado antes do despacho',async()=>{
 m.docs=[];await expect(prepareLoadDispatch('tenant',{id:'load',load_number:'1',destination:null},items,new AbortController().signal)).rejects.toThrow('não está disponível');
 m.version.updated_at='v2';await expect(assertLoadDispatchDraftCurrent('tenant',{name:'Rota',stops:[stop()],draftId:'draft',draftVersion:'v1'})).rejects.toThrow('outra tela');
});
