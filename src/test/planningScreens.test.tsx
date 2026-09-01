import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import LoadDetail from '@/pages/LoadDetail';
import RoutePlanning from '@/pages/RoutePlanning';
import {createDispatchOutbox,type DispatchWirePayload} from '@/lib/route-planning/dispatchOutbox';

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

const mock=vi.hoisted(()=>({rpc:vi.fn(),toast:vi.fn(),navigate:vi.fn(),tripId:null as string|null,
  loadError:false,tripLinksError:false,itemsError:false,itemRefetch:vi.fn(),
  load:{id:'load',load_number:'QA',tenant_id:'tenant',status:'ready',driver_id:'driver',vehicle_id:'vehicle',destination:'Destino QA'},
  items:[{id:'item-1',fiscal_document_id:'doc-1',pallet_count:1,weight_kg:10,volume_m3:1},
    {id:'item-2',fiscal_document_id:'doc-2',pallet_count:1,weight_kg:20,volume_m3:1}]}));
vi.mock('react-router-dom',()=>({useParams:()=>({id:'load'}),useNavigate:()=>mock.navigate}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'tenant'}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'actor'}})}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:mock.toast})}));
vi.mock('@/hooks/useLoadItems',()=>({useLoadItems:()=>({data:mock.items,isError:mock.itemsError,refetch:mock.itemRefetch})}));
vi.mock('@/hooks/useVehicles',()=>({useVehicles:()=>({data:[{id:'vehicle',plate:'QA-0001',active:true}]})}));
vi.mock('@/hooks/useGenerateCTe',()=>({useGenerateCTe:()=>({isPending:false,mutateAsync:()=>{throw new Error('No fiscal calls during planning QA');}})}));
vi.mock('@/hooks/useOperationalRoutes',()=>({useOperationalRoutes:()=>({data:[]})}));
vi.mock('@/hooks/route-planning/useCustomerDeliveryWindowsForRouting',()=>({useCustomerDeliveryWindowsForRouting:()=>({data:[]})}));
vi.mock('@/components/loads/LoadRomaneioTabs',()=>({default:()=>null}));
vi.mock('@/components/control-tower/TripOperationalEventsPanel',()=>({default:()=>null}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:(table:string)=>{
  const rows=table==='fiscal_documents'?[{id:'doc-1',invoice_number:'1'},{id:'doc-2',invoice_number:'2'}]:table==='drivers'?[{id:'driver',name:'Motorista QA',active:true}]:[];
  const query={select:()=>query,eq:()=>query,is:()=>query,in:()=>query,order:()=>query,
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
  Object.defineProperty(Element.prototype,'scrollIntoView',{configurable:true,value:vi.fn()});
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_key:string,work:()=>Promise<unknown>)=>work()}});
  mock.rpc.mockImplementation((name:string)=>({abortSignal:()=>Promise.resolve({data:name==='get_load_operational_documents'
    ?{tenant_id:'tenant',actor_id:'actor',load_id:'load',documents:[{id:'doc-1',invoice_number:'1',status:'confirmed',is_historical:false},
      {id:'doc-2',invoice_number:'2',status:'confirmed',is_historical:false}]}:trip,error:null})}));
  client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});});
afterEach(()=>{cleanup();client.clear();});
const show=(page:'load'|'routes')=>render(<QueryClientProvider client={client}>{page==='load'?<LoadDetail/>:<RoutePlanning/>}</QueryClientProvider>);
const dispatchCalls=()=>mock.rpc.mock.calls.filter(([name])=>name==='dispatch_planned_route');
async function seedPending(){
  const body:DispatchWirePayload={tenant_id:'tenant',driver_id:'driver',vehicle_id:'vehicle',planned_start_at:'2030-01-01T10:00:00Z',
    route_name:'Rota sem resposta',load_ids:['load'],stops:[],planning_draft_id:null};
  const outbox=createDispatchOutbox({storage:localStorage,uuid:()=>crypto.randomUUID(),lock:async(_key,work)=>work(),send:async()=>{throw new Error('Offline');}});
  await expect(outbox.dispatch('tenant','actor','load:load',body)).rejects.toThrow('Offline');
}
describe('real planning screens with isolated transport (not authenticated browser E2E)',()=>{
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
    expect(within(dialog).getByLabelText('Veículo')).toHaveAttribute('role','combobox');
    fireEvent.change(within(dialog).getByLabelText('Observações da primeira parada'),{target:{value:'Descarregar na portaria'}});
    fireEvent.click(within(dialog).getByRole('button',{name:/Criar Viagem com 1/}));
    await waitFor(()=>expect(dispatchCalls()).toHaveLength(1));
    expect(mock.rpc).toHaveBeenCalledWith('dispatch_planned_route',{_payload:expect.objectContaining({
      tenant_id:'tenant',idempotency_key:expect.any(String),load_ids:['load'],
      stops:[expect.objectContaining({fiscal_document_ids:['doc-1','doc-2'],load_ids:['load'],notes:'Descarregar na portaria'})],
    })});
    await waitFor(()=>expect(mock.toast).toHaveBeenCalledWith({title:'Viagem criada com sucesso'}));
  });
  it('LoadDetail does not create an empty extra stop with all documents silently left on the first',async()=>{
    show('load');fireEvent.click(await screen.findByRole('button',{name:'Despachar'}));const dialog=await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button',{name:'+ Parada'}));
    fireEvent.change(within(dialog).getByLabelText('Destino parada 2'),{target:{value:'Destino adicional'}});
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
  it('LoadDetail assigns separate documents to two stops using the actual selector',async()=>{
    show('load');fireEvent.click(await screen.findByRole('button',{name:'Despachar'}));const dialog=await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button',{name:'+ Parada'}));
    fireEvent.change(within(dialog).getByLabelText('Destino parada 2'),{target:{value:'Segundo destino'}});
    fireEvent.change(within(dialog).getByLabelText('Documento 2'),{target:{value:'1'}});
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
