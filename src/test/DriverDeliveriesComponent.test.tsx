import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import DriverDeliveries from '@/pages/driver/DriverDeliveries';

const mocks=vi.hoisted(() => ({
  stops:[] as Record<string,unknown>[], status:'in_transit', started:true, pending:false, readError:false,
  submit:vi.fn(),create:vi.fn(),toast:vi.fn(),navigate:vi.fn(),params:vi.fn(),invalidate:vi.fn(),eq:vi.fn(),rpc:vi.fn(),
  arrival:vi.fn(),
  selectedTrip:null as string|null,
  documents:[] as Record<string,unknown>[],items:[] as Record<string,unknown>[],
}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'tenant'}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'driver-user'}})}));
vi.mock('@/hooks/useCurrentDriver',()=>({
  useCurrentDriver:()=>({data:{id:'driver',user_id:'driver-user'},refetch:vi.fn()}),
  useActiveTrip:()=>({data:{id:'trip',status:mocks.status,actual_start_at:mocks.started?'2026-08-29T10:00:00Z':null,loads:{load_number:'1012'}},refetch:vi.fn()}),
}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:mocks.toast})}));
vi.mock('react-router-dom',()=>({useNavigate:()=>mocks.navigate,
  useSearchParams:()=>[new URLSearchParams(mocks.selectedTrip?{trip:mocks.selectedTrip}:{}),mocks.params]}));
vi.mock('@/lib/driver/driverDeliverySubmission',async importOriginal=>({
  ...await importOriginal<typeof import('@/lib/driver/driverDeliverySubmission')>(),
  createDeliverySubmission:mocks.create,invalidateDeliveryQueries:mocks.invalidate,
}));
vi.mock('@/lib/driver/driverArrival',()=>({markDriverArrival:mocks.arrival}));
vi.mock('@/components/driver/SignaturePad',()=>({default:({onChange}:{onChange:(value:string)=>void})=>
  <button onClick={()=>onChange('data:image/png;base64,AA==')}>Assinar teste</button>}));
vi.mock('@/components/ui/sheet',()=>({
  Sheet:({open,children}:{open:boolean;children:ReactNode})=>open?<section>{children}</section>:null,
  SheetContent:({children}:{children:ReactNode})=><div>{children}</div>,
  SheetHeader:({children}:{children:ReactNode})=><header>{children}</header>,
  SheetTitle:({children}:{children:ReactNode})=><h2>{children}</h2>,
}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
  rpc:mocks.rpc,
  from:(table:string)=>{
    const query={select:()=>query,eq:(...args:unknown[])=>{mocks.eq(table,...args);return query;},in:()=>query,order:()=>query,maybeSingle:()=>query,
      then:(resolve:(value:unknown)=>unknown)=>mocks.pending?new Promise(()=>undefined):Promise.resolve({
        data:table==='dispatch_stop_documents'?mocks.documents:table==='load_items'?mocks.items:table==='dispatch_stops'?mocks.stops:table==='dispatch_trips'?{id:'trip-selected',status:'completed',driver_id:'driver',tenant_id:'tenant',
          actual_start_at:'2026-08-29T10:00:00Z',dispatch_trip_loads:[],vehicles:null}:[],error:mocks.readError?{message:'Falha de rede'}:null,
      }).then(resolve)};
    return query;
  },
  channel:()=>{const channel={on:()=>channel,subscribe:()=>channel};return channel;},removeChannel:vi.fn(),
}}));
let client:QueryClient;
beforeEach(()=>{
  vi.clearAllMocks(); mocks.status='in_transit';mocks.started=true;mocks.pending=false;mocks.readError=false;mocks.selectedTrip=null;
  mocks.documents=[];mocks.items=[];
  mocks.stops=[{id:'stop',dispatch_trip_id:'trip',status:'arrived',destination:'Rua QA',actual_arrival_at:'2026-08-29T12:00:00Z',actual_departure_at:null,
    planned_arrival_at:null,dispatch_stop_documents:[],clients:{company_name:'Cliente QA'}}];
  mocks.submit.mockResolvedValue({event_id:'event',operational_event_id:'occurrence',replayed:false});
  mocks.arrival.mockResolvedValue('arrival-event');
  mocks.rpc.mockImplementation((name:string)=>({abortSignal:async()=>{
    if(name!=='get_driver_delivery_items')throw new Error('Unexpected RPC '+name);
    return {data:{tenant_id:'tenant',actor_id:'driver-user',trip_id:'trip',stop_id:'stop',items:mocks.items.map(item=>({...item,
      attempt_id:null,is_historical:false,document_status:(mocks.documents.find(doc=>doc.fiscal_document_id===item.fiscal_document_id)?.fiscal_documents as {status:string})?.status}))},
      error:mocks.readError?{message:'Falha de rede'}:null};
  }}));
  mocks.create.mockReturnValue({submit:mocks.submit,dispatched:true,canRevise:false}); mocks.invalidate.mockResolvedValue(undefined);
  vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=> 'blob:test'),revokeObjectURL:vi.fn()}));
  client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
});
afterEach(()=>{cleanup();client.clear();});
function renderPage(){return render(<QueryClientProvider client={client}><DriverDeliveries/></QueryClientProvider>);}
async function openDelivery(){
  renderPage(); fireEvent.click(await screen.findByRole('button',{name:/Cliente QA/}));
  fireEvent.click(screen.getByRole('button',{name:'TudoEntregue'}));
}
async function openEvent(label:string){
  renderPage();fireEvent.click(await screen.findByRole('button',{name:/Cliente QA/}));
  fireEvent.click(screen.getByRole('button',{name:'Lançar evento'}));fireEvent.click(screen.getByRole('button',{name:label}));
}
function fillProof(){
  fireEvent.change(screen.getByLabelText(/Recebedor/),{target:{value:'Recebedor QA'}});
  const fileInput=document.querySelector<HTMLInputElement>('input[type=file]')!;
  fireEvent.change(fileInput,{target:{files:[new File([new Uint8Array(16)],'foto.png',{type:'image/png'})]}});
  fireEvent.click(screen.getByRole('button',{name:'Assinar teste'}));
}

describe('driver deliveries rendered frontend',()=>{
  it('associates boleto fields with their visible labels',async()=>{
    await openEvent('ATUALIZAR BOLETO');
    for(const label of ['Novo vencimento sugerido','Detalhe / motivo']){
      const control=screen.getByLabelText(label),labelElement=screen.getByText(label,{selector:'label'});
      expect(control.id).not.toBe('');expect(labelElement).toHaveAttribute('for',control.id);
    }
  });
  it('names discount controls and exposes their selected state',async()=>{
    await openEvent('SOLICITAR DESCONTO');
    expect(screen.getByRole('group',{name:'Tipo do desconto'})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Desconto em porcentagem'})).toHaveAttribute('aria-pressed','true');
    expect(screen.getByRole('button',{name:'Desconto em reais'})).toHaveAttribute('aria-pressed','false');
    for(const label of ['Valor do desconto','Justificativa do desconto']){
      const control=screen.getByLabelText(label),labelElement=screen.getByText(label,{selector:'label'});
      expect(control.id).not.toBe('');expect(labelElement).toHaveAttribute('for',control.id);
    }
    expect(screen.getByLabelText('Capturar foto da entrega')).toHaveAttribute('type','file');
    expect(screen.getByLabelText('Selecionar fotos da entrega')).toHaveAttribute('type','file');
  });
  it.each(['delivered','partial_delivery','returned','refused','failed','cancelled','not_delivered'])('excludes %s note items from a total return while preserving the remaining quantities',async(status)=>{
    mocks.documents=[{fiscal_document_id:'completed-doc',fiscal_documents:{status}},{fiscal_document_id:'pending-doc',fiscal_documents:{status:'in_transit'}}];
    mocks.items=[{id:'completed-item',item_description:'Item já concluído',quantity:2,fiscal_document_id:'completed-doc'},
      {id:'pending-item',item_description:'Item restante',quantity:3,fiscal_document_id:'pending-doc'}];
    renderPage();fireEvent.click(await screen.findByRole('button',{name:/Cliente QA/}));fireEvent.click(screen.getByRole('button',{name:'Lançar evento'}));
    fireEvent.click(screen.getByRole('button',{name:'DEVOLUÇÃO TOTAL'}));await screen.findByText('Item restante');
    expect(screen.queryByText('Item já concluído')).not.toBeInTheDocument();expect(screen.getByText(/Notas já concluídas foram preservadas/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Marcar tudo'}));fireEvent.change(screen.getByLabelText('Motivo da devolução'),{target:{value:'Retorno conferido'}});
    fireEvent.click(screen.getByRole('button',{name:'Lançar evento'}));await screen.findByRole('button',{name:'Ver evento enviado à operação'});
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({eventKey:'devolucao_total',details:expect.objectContaining({returned_items:{'pending-item':3}})}));
  });
  it('shows loading rather than an empty active-trip state while stops load',()=>{
    mocks.pending=true;renderPage();expect(screen.getByRole('status')).toHaveTextContent('Carregando entregas');
    expect(screen.queryByText('Nenhuma viagem ativa')).not.toBeInTheDocument();
  });
  it('shows plain PostgREST errors and retries the reads',async()=>{
    mocks.readError=true;renderPage();expect(await screen.findByRole('alert')).toHaveTextContent('Falha de rede');
    mocks.readError=false;fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));
    expect(await screen.findByRole('button',{name:/Cliente QA/})).toBeInTheDocument();
  });
  it('requires start, arrival, receiver, photo and signature before submission',async()=>{
    mocks.started=false;await openDelivery();fillProof();expect(screen.getByRole('button',{name:'Lançar evento'})).toBeDisabled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('does not let a delivered label invent an arrival',async()=>{
    mocks.stops[0].actual_arrival_at=null;await openDelivery();fillProof();
    expect(screen.getByText('Registre a chegada antes do resultado da entrega.')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Lançar evento'})).toBeDisabled();
  });
  it('routes the arrival event through the shared GPS flow and refreshes the trip',async()=>{
    mocks.stops[0]={...mocks.stops[0],status:'pending',actual_arrival_at:null};
    renderPage();fireEvent.click(await screen.findByRole('button',{name:/Cliente QA/}));
    fireEvent.click(screen.getByRole('button',{name:'Lançar evento'}));
    fireEvent.click(screen.getByRole('button',{name:'CHEGADA NO CLIENTE'}));
    fireEvent.click(screen.getByRole('button',{name:'Lançar evento'}));
    await waitFor(()=>expect(mocks.arrival).toHaveBeenCalledWith('stop'));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.invalidate).toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith({title:'Chegada registrada'});
  });
  it('submits one snapshot, pins its trip and links to the actual operation event',async()=>{
    await openDelivery();expect(screen.getByRole('button',{name:'Lançar evento'})).toBeDisabled();fillProof();
    fireEvent.click(screen.getByRole('button',{name:'Lançar evento'}));
    expect(await screen.findByRole('button',{name:'Ver evento enviado à operação'})).toBeInTheDocument();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({tripId:'trip',stopId:'stop',eventKey:'entregue',expectedStatus:'arrived'}));
    expect(mocks.params).toHaveBeenCalledWith({trip:'trip'},{replace:true});
    expect(mocks.invalidate).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Ver evento enviado à operação'}));
    expect(mocks.navigate).toHaveBeenCalledWith('/driver/events/occurrence');
  });
  it('freezes the submitted snapshot on a lost response and retries the same attempt',async()=>{
    mocks.submit.mockRejectedValueOnce({message:'Resposta perdida'});
    await openDelivery();fillProof();fireEvent.click(screen.getByRole('button',{name:'Lançar evento'}));
    const retry=await screen.findByRole('button',{name:'Tentar novamente o mesmo envio'});
    await waitFor(()=>expect(retry).toBeEnabled());
    expect(screen.getByLabelText(/Recebedor/)).toBeDisabled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({description:'Resposta perdida'}));
    fireEvent.click(retry);await screen.findByRole('button',{name:'Ver evento enviado à operação'});
    expect(mocks.create).toHaveBeenCalledTimes(1);expect(mocks.submit).toHaveBeenCalledTimes(2);
  });
  it('labels a refused stop honestly instead of OK and never fabricates times',async()=>{
    mocks.stops[0].status='refused';renderPage();expect(await screen.findByText('Recusada')).toBeInTheDocument();
    expect(screen.queryByText('OK')).not.toBeInTheDocument();
    expect(screen.queryByText(/Operação CD/)).not.toBeInTheDocument();
  });
  it('keeps form values editable after a confirmed rejection and creates a fresh corrected attempt',async()=>{
    mocks.create.mockReturnValue({submit:mocks.submit,dispatched:true,canRevise:true});
    mocks.submit.mockRejectedValueOnce({code:'23514',message:'Corrija os dados da entrega'});
    await openDelivery();fillProof();fireEvent.click(screen.getByRole('button',{name:'Lançar evento'}));
    await waitFor(()=>expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({description:'Corrija os dados da entrega'})));
    expect(screen.getByLabelText(/Recebedor/)).toBeEnabled();
    expect(screen.getByLabelText(/Recebedor/)).toHaveValue('Recebedor QA');
    fireEvent.change(screen.getByLabelText(/Recebedor/),{target:{value:'Recebedor corrigido'}});
    fireEvent.click(screen.getByRole('button',{name:'Lançar evento'}));
    await screen.findByRole('button',{name:'Ver evento enviado à operação'});
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[1][0].details.receiver_name).toBe('Recebedor corrigido');
  });
  it('refreshes a rejected stop and uses its latest status without discarding proof fields',async()=>{
    mocks.create.mockReturnValue({submit:mocks.submit,dispatched:true,canRevise:true});
    mocks.submit.mockImplementationOnce(async()=>{
      mocks.stops=[{...mocks.stops[0],status:'servicing'}];
      throw {code:'40001',message:'Parada alterada durante o envio'};
    });
    mocks.invalidate.mockImplementationOnce(async()=>{await client.invalidateQueries({queryKey:['driver_delivery_stops']});});
    await openDelivery();fillProof();fireEvent.click(screen.getByRole('button',{name:'Lançar evento'}));
    await waitFor(()=>expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({description:'Parada alterada durante o envio'})));
    expect(screen.getByLabelText(/Recebedor/)).toHaveValue('Recebedor QA');
    fireEvent.click(screen.getByRole('button',{name:'Lançar evento'}));
    await screen.findByRole('button',{name:'Ver evento enviado à operação'});
    expect(mocks.create.mock.calls[1][0].expectedStatus).toBe('servicing');
    expect(mocks.create.mock.calls[1][0].photos).toHaveLength(1);
  });
  it('blocks a new attempt if the refreshed stop is already terminal but preserves the draft',async()=>{
    mocks.create.mockReturnValue({submit:mocks.submit,dispatched:true,canRevise:true});
    mocks.submit.mockImplementationOnce(async()=>{
      mocks.stops=[{...mocks.stops[0],status:'delivered'}];
      throw {code:'40001',message:'Parada concluída em outra sessão'};
    });
    mocks.invalidate.mockImplementationOnce(async()=>{await client.invalidateQueries({queryKey:['driver_delivery_stops']});});
    await openDelivery();fillProof();fireEvent.click(screen.getByRole('button',{name:'Lançar evento'}));
    expect(await screen.findByText('A parada foi encerrada ou reatribuída. Os campos preenchidos foram preservados.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Recebedor/)).toHaveValue('Recebedor QA');
    expect(screen.getByRole('button',{name:'Lançar evento'})).toBeDisabled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it('honors the explicit completed trip and scopes reads to driver and tenant',async()=>{
    mocks.selectedTrip='trip-selected';renderPage();await screen.findByRole('button',{name:/Cliente QA/});
    expect(mocks.eq).toHaveBeenCalledWith('dispatch_trips','id','trip-selected');
    expect(mocks.eq).toHaveBeenCalledWith('dispatch_trips','driver_id','driver');
    expect(mocks.eq).toHaveBeenCalledWith('dispatch_trips','tenant_id','tenant');
    expect(mocks.eq).toHaveBeenCalledWith('dispatch_stops','dispatch_trip_id','trip-selected');
  });
});
