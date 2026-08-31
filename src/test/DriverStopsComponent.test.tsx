import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DriverStops from '@/pages/driver/DriverStops';

const mocks=vi.hoisted(()=>({
  stop:{} as Record<string,unknown>,tripStatus:'in_transit',started:true,selected:null as string|null,
  driverPending:false,driverError:null as unknown,readError:null as unknown,
  rpc:vi.fn(),arrival:vi.fn(),invalidate:vi.fn(),toast:vi.fn(),navigate:vi.fn(),eq:vi.fn(),
}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'tenant'}})}));
vi.mock('@/hooks/useCurrentDriver',()=>({
  useCurrentDriver:()=>({data:mocks.driverPending?undefined:{id:'driver'},isLoading:mocks.driverPending,error:mocks.driverError,refetch:vi.fn()}),
  useActiveTrip:()=>({data:mocks.driverPending?null:{id:'trip',status:mocks.tripStatus,
    actual_start_at:mocks.started?'2026-08-29T10:00:00Z':null,loads:{load_number:'1012'}},refetch:vi.fn()}),
}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:mocks.toast})}));
vi.mock('react-router-dom',()=>({useNavigate:()=>mocks.navigate,useSearchParams:()=>[
  new URLSearchParams(mocks.selected?{trip:mocks.selected}:{}),vi.fn()]}));
vi.mock('@/lib/driver/driverArrival',()=>({markDriverArrival:mocks.arrival}));
vi.mock('@/lib/driver/driverDeliverySubmission',async original=>({
  ...await original<typeof import('@/lib/driver/driverDeliverySubmission')>(),invalidateDeliveryQueries:mocks.invalidate,
}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
  rpc:mocks.rpc,
  from:(table:string)=>{
    const query={select:()=>query,eq:(...args:unknown[])=>{mocks.eq(table,...args);return query;},order:()=>query,maybeSingle:()=>query,
      then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:table==='dispatch_stops'?[mocks.stop]:{
        id:'selected-trip',tenant_id:'tenant',driver_id:'driver',status:mocks.tripStatus,
        actual_start_at:mocks.started?'2026-08-29T10:00:00Z':null,dispatch_trip_loads:[],vehicles:null,
      },error:mocks.readError}).then(resolve)};
    return query;
  },
  channel:()=>{const channel={on:()=>channel,subscribe:()=>channel};return channel;},removeChannel:vi.fn(),
}}));
let client:QueryClient;
beforeEach(()=>{
  vi.clearAllMocks();mocks.tripStatus='in_transit';mocks.started=true;mocks.selected=null;mocks.driverPending=false;
  mocks.driverError=null;mocks.readError=null;
  mocks.stop={id:'stop',status:'arrived',destination:'Rua QA',actual_arrival_at:'2026-08-29T12:00:00Z',actual_departure_at:null,
    clients:{company_name:'Cliente QA'}};
  mocks.rpc.mockResolvedValue({data:'event',error:null});mocks.arrival.mockResolvedValue('arrival');
  mocks.invalidate.mockImplementation(async()=>{await client.invalidateQueries({queryKey:['driver_stops']});});
  client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
});
afterEach(()=>{cleanup();client.clear();});
const renderPage=()=>render(<QueryClientProvider client={client}><DriverStops/></QueryClientProvider>);

describe('driver stops rendered frontend',()=>{
  it('waits for driver lookup rather than showing no active trip',()=>{
    mocks.driverPending=true;renderPage();expect(screen.getByLabelText('Carregando viagem')).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma viagem ativa')).not.toBeInTheDocument();
  });
  it('shows a plain driver lookup error',async()=>{
    mocks.driverError={message:'Motorista indisponível'};renderPage();
    expect(await screen.findByText('Motorista indisponível')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Tentar novamente'})).toBeInTheDocument();
  });
  it('scopes explicit-trip and stop reads to tenant and driver',async()=>{
    mocks.selected='selected-trip';renderPage();await screen.findByText('Cliente QA');
    expect(mocks.eq).toHaveBeenCalledWith('dispatch_trips','id','selected-trip');
    expect(mocks.eq).toHaveBeenCalledWith('dispatch_trips','driver_id','driver');
    expect(mocks.eq).toHaveBeenCalledWith('dispatch_trips','tenant_id','tenant');
    expect(mocks.eq).toHaveBeenCalledWith('dispatch_stops','tenant_id','tenant');
    expect(mocks.eq).toHaveBeenCalledWith('dispatch_stops','dispatch_trip_id','selected-trip');
  });
  it.each(['pending','planned','arriving'])('offers GPS arrival for %s stops',async status=>{
    mocks.stop={...mocks.stop,status,actual_arrival_at:null};renderPage();
    fireEvent.click(await screen.findByRole('button',{name:'Cheguei'}));
    await waitFor(()=>expect(mocks.arrival).toHaveBeenCalledWith('stop'));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('disables departure before a real start and before arrival',async()=>{
    mocks.started=false;renderPage();expect(await screen.findByRole('button',{name:'Registrar saída'})).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Inicie a viagem');expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not enable departure based only on an arrived label',async()=>{
    mocks.stop.actual_arrival_at=null;renderPage();expect(await screen.findByRole('button',{name:'Registrar saída'})).toBeDisabled();
  });
  it('records departure through the compatible API and refreshes interconnected queries',async()=>{
    mocks.rpc.mockImplementation(async()=>{mocks.stop={...mocks.stop,actual_departure_at:'2026-08-29T12:30:00Z'};return {data:'event',error:null};});
    renderPage();fireEvent.click(await screen.findByRole('button',{name:'Registrar saída'}));
    expect(await screen.findByText('Saída registrada')).toBeInTheDocument();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('driver_register_departure',{_stop_id:'stop',_notes:undefined});
    expect(mocks.invalidate).toHaveBeenCalled();
    expect(screen.queryByRole('button',{name:'Registrar saída'})).not.toBeInTheDocument();
    expect(screen.getByText(/Registrar saída não conclui a entrega/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Registrar resultado da entrega'}));
    expect(mocks.navigate).toHaveBeenCalledWith('/driver/deliveries?trip=trip');
  });
  it('surfaces a backend error and permits an identical retry',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'23514',message:'Registre a chegada antes da saída'}});
    renderPage();fireEvent.click(await screen.findByRole('button',{name:'Registrar saída'}));
    await waitFor(()=>expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({description:'Registre a chegada antes da saída'})));
    fireEvent.click(screen.getByRole('button',{name:'Registrar saída'}));
    await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledTimes(2));
    expect(mocks.rpc.mock.calls[1]).toEqual(mocks.rpc.mock.calls[0]);
  });
  it('does not offer mutations or describe refusal as successful delivery',async()=>{
    mocks.stop.status='refused';renderPage();expect(await screen.findByText('Recusada')).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Registrar saída'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Cheguei'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Registrar resultado da entrega'})).not.toBeInTheDocument();
  });
});
