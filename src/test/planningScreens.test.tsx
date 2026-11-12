import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import LoadDetail from '@/pages/LoadDetail';
import RoutePlanning from '@/pages/RoutePlanning';
import {createDispatchOutbox,type DispatchWirePayload} from '@/lib/route-planning/dispatchOutbox';
import type {LoadDispatchPreparation} from '@/lib/route-planning/loadDispatchPreparation';

vi.mock('@/components/ui/select',async()=>{
  const React=await import('react');
  type ChildProps={id?:string;value?:string;disabled?:boolean;children?:import('react').ReactNode};
  const SelectTrigger=()=>null;
  const SelectContent=()=>null;
  const SelectItem=()=>null;
  const SelectValue=()=>null;
  const Select=({children,value,onValueChange,disabled}:{children?:import('react').ReactNode;value?:string;
    onValueChange?:(value:string)=>void;disabled?:boolean})=>{
    let id:string|undefined;const options:Array<{value:string;disabled?:boolean;text:string}>=[];
    const textOf=(node:import('react').ReactNode):string=>React.Children.toArray(node).map(child=>
      typeof child==='string'||typeof child==='number'?String(child):
        React.isValidElement<ChildProps>(child)?textOf(child.props.children):'').join(' ').replace(/\s+/g,' ')
      .replace(/\s+([:;,.])/g,'$1').trim();
    const visit=(node:import('react').ReactNode):void=>React.Children.forEach(node,child=>{
      if(!React.isValidElement<ChildProps>(child))return;
      if(child.type===SelectTrigger)id=child.props.id;
      else if(child.type===SelectItem&&child.props.value)options.push({value:child.props.value,
        disabled:child.props.disabled,text:textOf(child.props.children)});
      else visit(child.props.children);
    });
    visit(children);
    return React.createElement('select',{id,role:'combobox',value,disabled,onChange:(event:import('react').ChangeEvent<HTMLSelectElement>)=>
      onValueChange?.(event.currentTarget.value)},
    React.createElement('option',{value:'',disabled:true},''),
    ...options.map(option=>React.createElement('option',{key:option.value,value:option.value,disabled:option.disabled},option.text)));
  };
  return {Select,SelectTrigger,SelectContent,SelectItem,SelectValue,SelectGroup:SelectContent,
    SelectLabel:SelectContent,SelectSeparator:()=>null,SelectScrollUpButton:()=>null,SelectScrollDownButton:()=>null};
});

const mock=vi.hoisted(()=>({prepare:vi.fn(),resolveLocations:vi.fn(),assertPlan:vi.fn(),rpc:vi.fn(),toast:vi.fn(),navigate:vi.fn(),tripId:null as string|null,
  loadError:false,tripLinksError:false,itemsError:false,itemRefetch:vi.fn(),
  load:{id:'load',load_number:'QA',tenant_id:'tenant',status:'ready',driver_id:'driver',vehicle_id:'vehicle',destination:'Destino QA'},
  items:[{id:'item-1',fiscal_document_id:'doc-1',pallet_count:1,weight_kg:10,volume_m3:1},
    {id:'item-2',fiscal_document_id:'doc-2',pallet_count:1,weight_kg:20,volume_m3:1}]}));
vi.mock('react-router-dom',()=>({useParams:()=>({id:'load'}),useNavigate:()=>mock.navigate}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'tenant'}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'actor'}})}));
vi.mock('@/lib/route-planning/loadDispatchPreparation',async(importActual)=>({...await importActual<object>(),
  prepareLoadDispatch:mock.prepare,resolveAutomaticStopLocations:mock.resolveLocations,assertLoadDispatchDraftCurrent:mock.assertPlan}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:mock.toast})}));
vi.mock('@/hooks/useLoadItems',()=>({useLoadItems:()=>({data:mock.items,isError:mock.itemsError,refetch:mock.itemRefetch})}));
vi.mock('@/hooks/useVehicles',()=>({useVehicles:()=>({data:[{id:'vehicle',plate:'QA-0001',active:true}]})}));
vi.mock('@/hooks/useDrivers',()=>({useDrivers:()=>({data:[{id:'driver',name:'Motorista QA',active:true}]})}));
vi.mock('@/hooks/useGenerateCTe',()=>({useGenerateCTe:()=>({isPending:false,mutateAsync:()=>{throw new Error('No fiscal calls during planning QA');}})}));
vi.mock('@/hooks/useOperationalRoutes',()=>({useOperationalRoutes:()=>({data:[]})}));
vi.mock('@/hooks/route-planning/useCustomerDeliveryWindowsForRouting',()=>({useCustomerDeliveryWindowsForRouting:()=>({data:[]})}));
vi.mock('@/components/loads/LoadRomaneioTabs',()=>({default:()=>null}));
vi.mock('@/components/control-tower/TripOperationalEventsPanel',()=>({default:()=>null}));
vi.mock('@/components/maps/LocationPicker',()=>({LocationPicker:({idPrefix,address,onChange}:{idPrefix?:string;address:string;
  onChange:(value:unknown)=>void})=><button type="button" aria-label={`Selecionar localização ${idPrefix}`}
    onClick={()=>onChange({latitude:idPrefix==='dispatch-stop-1'?-22.9:-23.55052,
      longitude:idPrefix==='dispatch-stop-1'?-43.2:-46.633308,source:'map_selected',address,
      provider:'test-map',accuracy_m:null,confidence:1,audit:{selected_interactively:true}})}>Selecionar no mapa</button>}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:(table:string)=>{
  const rows=table==='fiscal_documents'?[{id:'doc-1',invoice_number:'1'},{id:'doc-2',invoice_number:'2'}]:table==='drivers'?[{id:'driver',name:'Motorista QA',active:true}]:[];
  const query={select:()=>query,eq:()=>query,is:()=>query,in:()=>query,order:()=>query,range:()=>query,
    maybeSingle:async()=>table==='loads' && mock.loadError
      ? {data:null,error:new Error('QA load read failure')}
      : {data:table==='loads'?{...mock.load,trip_id:mock.tripId}:null,error:null},
    then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(table==='dispatch_trip_loads' && mock.tripLinksError
      ? {data:null,error:new Error('QA trip link failure')}
      : {data:rows,error:null}).then(resolve)};
  return query;
}}}));
const trip='80000000-0000-4000-8000-000000000001';let client:QueryClient;
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();mock.tripId=null;mock.loadError=false;mock.tripLinksError=false;mock.itemsError=false;mock.load.status='ready';
  mock.assertPlan.mockResolvedValue(undefined);
  mock.prepare.mockResolvedValue({name:'Carga QA',stops:[{id:'stop-0',recipient_name:'Destino QA',destination:'Destino QA',
    load_ids:['load'],fiscal_document_ids:['doc-1','doc-2'],invoice_numbers:[],total_weight_kg:30,total_volume_m3:2,
    total_pallet_count:2,total_value:0,service_time_minutes:20,priority:0,risk_level:'normal'}]});
  Object.defineProperty(Element.prototype,'scrollIntoView',{configurable:true,value:vi.fn()});
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_key:string,work:()=>Promise<unknown>)=>work()}});
  mock.rpc.mockImplementation((name:string)=>({abortSignal:()=>Promise.resolve({data:name==='get_load_operational_documents'
    ?{tenant_id:'tenant',actor_id:'actor',load_id:'load',documents:[{id:'doc-1',invoice_number:'1',status:'confirmed',is_historical:false},
      {id:'doc-2',invoice_number:'2',status:'confirmed',is_historical:false}]}:trip,error:null})}));
  client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});});
afterEach(()=>{cleanup();client.clear();});
const show=(page:'load'|'routes')=>render(<QueryClientProvider client={client}>{page==='load'?<LoadDetail/>:<RoutePlanning/>}</QueryClientProvider>);
const dispatchCalls=()=>mock.rpc.mock.calls.filter(([name])=>name==='dispatch_planned_route_v3');
async function seedPending(){
  const body:DispatchWirePayload={tenant_id:'tenant',driver_id:'driver',vehicle_id:'vehicle',planned_start_at:'2030-01-01T10:00:00Z',
    route_name:'Rota sem resposta',load_ids:['load'],stops:[],planning_draft_id:null};
  const outbox=createDispatchOutbox({storage:localStorage,uuid:()=>crypto.randomUUID(),lock:async(_key,work)=>work(),send:async()=>{throw new Error('Offline');}});
  await expect(outbox.dispatch('tenant','actor','load:load',body)).rejects.toThrow('Offline');
}
describe('real planning screens with isolated transport (not authenticated browser E2E)',()=>{
  it('keeps dispatch blocked after confirming only one stop and resumes lookup without losing that point or notes',async()=>{
    const stop=(id:string,doc:string)=>({id,destination:id,recipient_name:id,client_id:id,load_ids:['load'],
      fiscal_document_ids:[doc],invoice_numbers:[],location_address:`Rua QA ${id}`,total_weight_kg:0,total_volume_m3:0,
      total_pallet_count:0,total_value:0,service_time_minutes:20,priority:0,risk_level:'normal'});
    mock.prepare.mockResolvedValueOnce({name:'QA',stops:[stop('s1','doc-1'),stop('s2','doc-2')],locationWarning:'Busca interrompida.'});
    mock.resolveLocations.mockImplementationOnce(async(stops)=>stops.map((s:Record<string,unknown>)=>({...s,
      latitude:-16,longitude:-44,location_source:'address_geocoded'})));
    show('load');fireEvent.click(await screen.findByRole('button',{name:'Despachar'}));const dialog=await screen.findByRole('dialog');
    const create=await within(dialog).findByRole('button',{name:/Criar Viagem com 2/});expect(create).toBeDisabled();
    fireEvent.click(within(dialog).getAllByRole('button',{name:'Confirmar endereço ou ponto no mapa'})[0]);
    fireEvent.click(within(dialog).getByLabelText('Selecionar localização dispatch-stop-0'));
    expect(create).toBeDisabled();expect(within(dialog).getByText(/Falta confirmar 1 parada/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Observações da primeira parada'),{target:{value:'Manter instrução QA'}});
    fireEvent.click(within(dialog).getByRole('button',{name:'Consultar novamente locais pendentes'}));
    await waitFor(()=>expect(create).not.toBeDisabled());
    expect(within(dialog).getByLabelText('Observações da primeira parada')).toHaveValue('Manter instrução QA');
    fireEvent.click(create);await waitFor(()=>expect(dispatchCalls()).toHaveLength(1));
    const payload=dispatchCalls()[0][1]._payload;
    expect(payload.stops[0]).toMatchObject({latitude:-23.55052,longitude:-46.633308,fiscal_document_ids:['doc-1']});
    expect(payload.stops[1]).toMatchObject({latitude:-16,longitude:-44,fiscal_document_ids:['doc-2']});
  });
  it('LoadDetail invalidates the old point and searches the edited destination instead of the previous street',async()=>{
    mock.prepare.mockResolvedValueOnce({name:'Carga QA',stops:[{id:'stop-0',recipient_name:'Destino QA',destination:'Destino QA',
      load_ids:['load'],fiscal_document_ids:['doc-1','doc-2'],invoice_numbers:[],total_weight_kg:30,total_volume_m3:2,
      total_pallet_count:2,total_value:0,service_time_minutes:20,priority:0,risk_level:'normal',
      location_address:'Rua anterior, 10',latitude:-16,longitude:-44,location_source:'map_selected'}]});
    show('load');fireEvent.click(await screen.findByRole('button',{name:'Despachar'}));const dialog=await screen.findByRole('dialog');
    await within(dialog).findByRole('button',{name:'Local verificado — revisar'});
    fireEvent.change(within(dialog).getByLabelText('Destino parada 1'),{target:{value:'Rua nova, 20'}});
    expect(within(dialog).queryByText('Rua anterior, 10')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar endereço ou ponto no mapa'}));
    fireEvent.click(within(dialog).getByLabelText('Selecionar localização dispatch-stop-0'));
    fireEvent.click(within(dialog).getByRole('button',{name:/Criar Viagem com 1/}));
    await waitFor(()=>expect(dispatchCalls()).toHaveLength(1));
    expect(dispatchCalls()[0][1]._payload.stops[0]).toMatchObject({destination:'Rua nova, 20',location_address:'Rua nova, 20',
      latitude:-23.55052,longitude:-46.633308});
  });
  it('LoadDetail displays bound notes while address lookup is pending and preserves them after provider failure',async()=>{
    const plan:LoadDispatchPreparation={name:'Carga QA',stops:[{id:'stop-0',recipient_name:'Destino QA',destination:'Destino QA',
      load_ids:['load'],fiscal_document_ids:['doc-1','doc-2'],invoice_numbers:[],total_weight_kg:30,total_volume_m3:2,
      total_pallet_count:2,total_value:0,service_time_minutes:20,priority:0,risk_level:'normal',location_address:'Rua QA, 10, Cidade - MG'}]};
    let finish!:()=>void;
    mock.prepare.mockImplementationOnce((_tenant,_load,_items,_signal,onPrepared:(plan:LoadDispatchPreparation)=>void)=>{
      onPrepared(plan);return new Promise(resolve=>{finish=()=>resolve({...plan,locationWarning:'Serviço indisponível. As notas continuam distribuídas.'});});
    });
    show('load');fireEvent.click(await screen.findByRole('button',{name:'Despachar'}));const dialog=await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Notas distribuídas. Consultando os locais');
    expect(within(dialog).getByRole('button',{name:/Criar Viagem com 1/})).toBeDisabled();
    fireEvent.click(within(dialog).getByText(/Notas distribuídas automaticamente/));
    const document=await within(dialog).findByLabelText('Documento 2');expect(document).toHaveValue('0');expect(document).toBeDisabled();
    expect(within(dialog).getByText('Rua QA, 10, Cidade - MG')).toBeInTheDocument();
    await act(async()=>{finish();});
    expect(within(dialog).getByRole('alert')).toHaveTextContent('As notas continuam distribuídas');
    expect(document).toHaveValue('0');expect(document).not.toBeDisabled();expect(dispatchCalls()).toHaveLength(0);
  });
  it('LoadDetail dispatches the saved route without asking to redistribute notes or reconfirm verified locations',async()=>{
    const stop=(id:string,doc:string)=>({id,recipient_name:id,destination:id,load_ids:['load'],fiscal_document_ids:[doc],invoice_numbers:[],
      total_weight_kg:10,total_volume_m3:1,total_pallet_count:1,total_value:50,service_time_minutes:45,priority:0,risk_level:'normal',
      latitude:-16,longitude:-44,location_source:'map_selected',planned_arrival_at:'2030-01-01T12:00:00Z',delivery_window_start:'08:00'});
    mock.prepare.mockResolvedValueOnce({name:'Rota já planejada',draftId:'draft',draftVersion:'v1',driverId:'driver',vehicleId:'vehicle',
      plannedStart:'2030-01-01T10:00:00Z',stops:[stop('Entrega 2','doc-2'),stop('Entrega 1','doc-1')]});
    show('load');fireEvent.click(await screen.findByRole('button',{name:'Despachar'}));const dialog=await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button',{name:/Criar Viagem com 2/}));
    await waitFor(()=>expect(dispatchCalls()).toHaveLength(1));
    expect(dispatchCalls()[0][1]._payload).toMatchObject({planning_draft_id:'draft',route_name:'Rota já planejada',planned_start_at:'2030-01-01T10:00:00.000Z',
      stops:[{fiscal_document_ids:['doc-2'],latitude:-16,service_time_minutes:45,planned_arrival_at:'2030-01-01T12:00:00.000Z',delivery_window_start:'08:00'},
        {fiscal_document_ids:['doc-1'],latitude:-16}]});
  });
  it('LoadDetail does not dispatch when the saved route changed in another screen',async()=>{
    mock.assertPlan.mockRejectedValueOnce(new Error('A rota foi alterada em outra tela.'));
    show('load');fireEvent.click(await screen.findByRole('button',{name:'Despachar'}));const dialog=await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button',{name:'Confirmar endereço ou ponto no mapa'}));
    fireEvent.click(within(dialog).getByLabelText('Selecionar localização dispatch-stop-0'));
    fireEvent.click(await within(dialog).findByRole('button',{name:/Criar Viagem com 1/}));
    await waitFor(()=>expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({description:'A rota foi alterada em outra tela.'})));
    expect(dispatchCalls()).toHaveLength(0);
  });
  it('LoadDetail keeps preparation failures visible and blocks empty fallback dispatch',async()=>{
    mock.prepare.mockRejectedValueOnce(new Error('Não foi possível carregar o planejamento.'));
    show('load');fireEvent.click(await screen.findByRole('button',{name:'Despachar'}));const dialog=await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Não foi possível carregar o planejamento.');
    expect(within(dialog).getByRole('button',{name:/Criar Viagem/})).toBeDisabled();expect(dispatchCalls()).toHaveLength(0);
  });
  it('does not report a failed load read as a missing load',async()=>{
    mock.loadError=true;show('load');expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar a carga');
    expect(screen.queryByText('Carga não encontrada')).not.toBeInTheDocument();
  });
  it('does not infer that there is no trip when the canonical link read fails',async()=>{
    mock.load.status='loaded';mock.tripLinksError=true;show('load');
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível confirmar o vínculo entre carga e viagem');
    expect(screen.queryByRole('button',{name:'Em Trânsito'})).not.toBeInTheDocument();
    expect(screen.queryByText('Crie uma viagem antes de colocar a carga em trânsito.')).not.toBeInTheDocument();
  });
  it('LoadDetail sends every document through the shared durable dispatch client',async()=>{
    show('load');fireEvent.click(await screen.findByRole('button',{name:'Despachar'}));
    const dialog=await screen.findByRole('dialog');expect(within(dialog).getByLabelText('Motorista')).toHaveAttribute('role','combobox');
    await within(dialog).findByRole('button',{name:/Criar Viagem com 1/});
    expect(within(dialog).getByLabelText('Veículo')).toHaveAttribute('role','combobox');
    fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar endereço ou ponto no mapa'}));
    fireEvent.click(within(dialog).getByLabelText('Selecionar localização dispatch-stop-0'));
    fireEvent.change(within(dialog).getByLabelText('Observações da primeira parada'),{target:{value:'Descarregar na portaria'}});
    fireEvent.click(within(dialog).getByRole('button',{name:/Criar Viagem com 1/}));
    await waitFor(()=>expect(dispatchCalls()).toHaveLength(1));
    expect(mock.rpc).toHaveBeenCalledWith('dispatch_planned_route_v3',{_payload:expect.objectContaining({
      tenant_id:'tenant',idempotency_key:expect.any(String),load_ids:['load'],
      stops:[expect.objectContaining({fiscal_document_ids:['doc-1','doc-2'],load_ids:['load'],notes:'Descarregar na portaria',
        latitude:-23.55052,longitude:-46.633308,location_source:'map_selected'})],
    })});
    await waitFor(()=>expect(mock.toast).toHaveBeenCalledWith({title:'Viagem criada com sucesso'}));
  });
  it('LoadDetail does not create an empty extra stop with all documents silently left on the first',async()=>{
    show('load');fireEvent.click(await screen.findByRole('button',{name:'Despachar'}));const dialog=await screen.findByRole('dialog');
    await within(dialog).findByRole('button',{name:/Criar Viagem com 1/});
    fireEvent.click(within(dialog).getByRole('button',{name:'+ Parada'}));
    fireEvent.change(within(dialog).getByLabelText('Destino parada 2'),{target:{value:'Destino adicional'}});
    for(let index=0;index<2;index++){
      fireEvent.click(within(dialog).getAllByRole('button',{name:'Confirmar endereço ou ponto no mapa'})[0]);
      fireEvent.click(within(dialog).getByLabelText(`Selecionar localização dispatch-stop-${index}`));
    }
    fireEvent.click(within(dialog).getByRole('button',{name:/Criar Viagem com 2/}));
    await waitFor(()=>expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({description:'Informe o destino e distribua os documentos de cada parada.'})));
    expect(dispatchCalls()).toHaveLength(0);
  });
  it('LoadDetail shows recovery outside the dispatch dialog even after the load is assigned',async()=>{
    await seedPending();mock.tripId=trip;show('load');await screen.findByText('Carga QA');
    expect(screen.queryByRole('button',{name:'Despachar'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Recuperar despacho'}));
    await waitFor(()=>expect(mock.toast).toHaveBeenCalledWith({title:'Despacho confirmado'}));
  });
  it('LoadDetail blocks dispatch before transport when the physical stop has no coordinates',async()=>{
    show('load');fireEvent.click(await screen.findByRole('button',{name:'Despachar'}));const dialog=await screen.findByRole('dialog');
    await within(dialog).findByRole('button',{name:/Criar Viagem com 1/});
    expect(within(dialog).getByRole('button',{name:/Criar Viagem com 1/})).toBeDisabled();
    expect(within(dialog).getByText(/Falta confirmar 1 parada/)).toBeInTheDocument();
    expect(dispatchCalls()).toHaveLength(0);
  });
  it('LoadDetail sends a detailed audited exception when location cannot be verified',async()=>{
    show('load');fireEvent.click(await screen.findByRole('button',{name:'Despachar'}));const dialog=await screen.findByRole('dialog');
    await within(dialog).findByRole('button',{name:/Criar Viagem com 1/});
    fireEvent.change(within(dialog).getByLabelText('Exceção operacional (mínimo 20 caracteres)'),{
      target:{value:'Acesso rural ainda sem endereço cartográfico confirmado.'},
    });
    fireEvent.click(within(dialog).getByRole('button',{name:/Criar Viagem com 1/}));
    await waitFor(()=>expect(dispatchCalls()).toHaveLength(1));
    expect(dispatchCalls()[0][1]._payload.stops).toEqual([expect.objectContaining({
      latitude:null,longitude:null,location_source:'legacy_coordinates',
      location_exception_reason:'Acesso rural ainda sem endereço cartográfico confirmado.',
    })]);
  });
  it('LoadDetail assigns separate documents to two stops using the actual selector',async()=>{
    show('load');fireEvent.click(await screen.findByRole('button',{name:'Despachar'}));const dialog=await screen.findByRole('dialog');
    await within(dialog).findByRole('button',{name:/Criar Viagem com 1/});
    fireEvent.click(within(dialog).getAllByRole('button',{name:'Confirmar endereço ou ponto no mapa'})[0]);
    fireEvent.click(within(dialog).getByLabelText('Selecionar localização dispatch-stop-0'));
    fireEvent.click(within(dialog).getByRole('button',{name:'+ Parada'}));
    fireEvent.change(within(dialog).getByLabelText('Destino parada 2'),{target:{value:'Segundo destino'}});
    fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar endereço ou ponto no mapa'}));
    fireEvent.click(within(dialog).getByLabelText('Selecionar localização dispatch-stop-1'));
    fireEvent.click(within(dialog).getByText(/Notas distribuídas automaticamente/));
    fireEvent.change(await within(dialog).findByLabelText('Documento 2'),{target:{value:'1'}});
    expect(within(dialog).getByLabelText('Documento 2')).toHaveValue('1');
    fireEvent.click(within(dialog).getByRole('button',{name:/Criar Viagem com 2/}));
    await waitFor(()=>expect(dispatchCalls()).toHaveLength(1));
    expect(dispatchCalls()[0][1]._payload.stops.map((stop:{fiscal_document_ids:string[]})=>stop.fiscal_document_ids))
      .toEqual([['doc-1'],['doc-2']]);
  });
  it('RoutePlanning keeps recovery visible when committed loads no longer appear as pending drafts',async()=>{
    await seedPending();show('routes');await screen.findByText(/Nenhuma carga pendente para roteirização/);
    expect(screen.getByText(/Rota sem resposta/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Recuperar despacho'}));
    await waitFor(()=>expect(mock.rpc).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(screen.queryByRole('region',{name:'Recuperação de despachos'})).not.toBeInTheDocument());
  });
});
