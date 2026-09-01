import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { PGlite } from '@electric-sql/pglite';
import OperationsControl from '@/pages/OperationsControl';
import { controlTowerDatabase, seedTower, towerIds as i, towerRead } from './helpers/controlTowerDatabase';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});

const state=vi.hoisted(()=>({rpc:vi.fn(),invoke:vi.fn(),toast:vi.fn(),ssx:false}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...args:unknown[])=>state.rpc(...args),functions:{invoke:(...args:unknown[])=>state.invoke(...args)}}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'10000000-0000-4000-8000-000000000001'}})}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'20000000-0000-4000-8000-000000000001'}})}));
vi.mock('@/hooks/useTripOperationalEvents',()=>({useTripOperationalEvents:()=>({data:[],isPending:false,isError:false,refetch:vi.fn()})}));
vi.mock('@/hooks/useTenantCapabilities',()=>({useTenantCapabilities:()=>({isEnabled:()=>state.ssx,isError:false})}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:state.toast})}));
// Only the tile/map renderer is replaced: page, hooks, drawer, validators and SQL are real.
vi.mock('@/components/control-tower/ControlTowerMap',()=>({default:()=> <div aria-label="Mapa local sem rede"/>}));
let db:PGlite, client:QueryClient, serial=Promise.resolve();
beforeAll(async()=>{db=await controlTowerDatabase();await seedTower(db);},20000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
  localStorage.clear();await db.exec('begin');state.ssx=false;state.toast.mockReset();state.rpc.mockReset();state.invoke.mockReset().mockResolvedValue({data:{ok:true},error:null});
  state.rpc.mockImplementation((name:string,args:{_tenant_id:string})=>({abortSignal:(signal:AbortSignal)=>{
    const task=serial.then(async()=>{
      if(signal.aborted) return {data:null,error:new Error('Aborted')};
      await db.exec('savepoint ui_rpc');
      try{return {data:await towerRead(db,name,args._tenant_id),error:null};}
      catch(error){await db.exec('rollback to ui_rpc');return {data:null,error};}
    });serial=task.then(()=>undefined);return task;
  }}));
  client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}});
});
afterEach(async()=>{cleanup();client.clear();await serial;await db.exec('rollback');});
function open(){render(<QueryClientProvider client={client}><MemoryRouter><OperationsControl/></MemoryRouter></QueryClientProvider>);}
async function loaded(){await screen.findByRole('button',{name:/QA-1234/});}
describe('Control Tower page → actual read hooks → PostgreSQL',()=>{
  it('does not present zero counts or a blank map before the first reads finish',()=>{
    state.rpc.mockImplementation(()=>({abortSignal:()=>new Promise(()=>{})}));
    open();
    expect(screen.getByText('Viagens (—)')).toBeInTheDocument();
    expect(screen.getByText('Alertas (—)')).toBeInTheDocument();
    expect(screen.getByText('Carregando indicadores…')).toBeInTheDocument();
    expect(screen.getByText('Carregando alertas…')).toBeInTheDocument();
    expect(screen.getByText('Carregando viagens…')).toBeInTheDocument();
    expect(screen.getByText('Carregando mapa operacional…')).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma viagem ativa.')).not.toBeInTheDocument();
  });
  it('shows transit/loads/stops and keeps SSX disabled without a background Edge write',async()=>{
    open();await loaded();expect(state.invoke).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Reavaliar rastreamento'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:/QA-1234/}));
    expect(await screen.findByText('Viagem 1003 · Motorista QA')).toBeInTheDocument();
    expect(screen.getByText('1. Cliente QA')).toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Abrir carga'})).toHaveAttribute('href','/loads/'+i.load);
  });
  it('refreshes the selected drawer from current stop data and closes it once the trip ends',async()=>{
    open();await loaded();fireEvent.click(screen.getByRole('button',{name:/QA-1234/}));
    await db.query("update dispatch_stops set status='returned',actual_arrival_at=now() where id=$1",[i.stop]);
    await client.invalidateQueries({queryKey:['active-trips-live']});
    expect(await screen.findByText('Concluídas (1)')).toBeInTheDocument();
    await db.query("update dispatch_trips set status='completed' where id=$1",[i.trip]);
    await client.invalidateQueries({queryKey:['active-trips-live']});
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('does not turn permission loss into empty success or leave the old drawer visible',async()=>{
    open();await loaded();fireEvent.click(screen.getByRole('button',{name:/QA-1234/}));
    await db.exec('update tenant_memberships set active=false');
    await client.invalidateQueries();
    expect(await screen.findByText(/Não foi possível consultar as viagens/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Nenhuma viagem ativa.')).not.toBeInTheDocument();
    expect(screen.queryByText('Nenhum alerta aberto.')).not.toBeInTheDocument();
    expect(screen.getByText('Viagens (—)')).toBeInTheDocument();
    expect(screen.getByText('Alertas (—)')).toBeInTheDocument();
    expect(screen.getByText('Indicadores indisponíveis.')).toBeInTheDocument();
    expect(screen.getByText('Alertas indisponíveis.')).toBeInTheDocument();
    expect(screen.getByText('Viagens indisponíveis.')).toBeInTheDocument();
    expect(screen.getByText(/Mapa indisponível porque as viagens/)).toBeInTheDocument();
  });
  it('validates a response tenant before rendering it',async()=>{
    const foreign=await towerRead<Record<string,unknown>[]>(db);
    state.rpc.mockImplementation((name:string)=>({abortSignal:async()=>({data:name==='get_active_trips_live'?foreign.map(t=>({...t,tenant_id:i.other})):[],error:null})}));
    open();expect(await screen.findByText(/Não foi possível consultar as viagens/)).toBeInTheDocument();expect(screen.queryByText('QA-1234')).not.toBeInTheDocument();
  });
  it('counts a resolved Edge error as failure, never as a successful route',async()=>{
    state.invoke.mockResolvedValueOnce({data:null,error:new Error('HTTP 403')}).mockImplementationOnce((_name:string,args:{body:{trip_id:string;request_id:string}})=>({data:{ok:true,...args.body,route_id:i.stop,calculated_at:new Date().toISOString(),distance_meters:20,duration_seconds:10,waypoint_count:2},error:null}));
    open();await loaded();fireEvent.click(screen.getByRole('button',{name:'Calcular todas'}));
    await waitFor(()=>expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Cálculo com falhas',description:'1 sucesso, 1 falha via OSRM.'})));
  });
  it('does not announce success when a single route returns an application error',async()=>{
    state.invoke.mockResolvedValue({data:{error:'unavailable'},error:null});open();await loaded();fireEvent.click(screen.getByRole('button',{name:/QA-1234/}));
    fireEvent.click(screen.getByRole('button',{name:'Recalcular rota (OSRM)'}));
    await waitFor(()=>expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Falha ao calcular rota'})));
  });
  it('only reevaluates telemetry after an explicit click with capability enabled',async()=>{
    state.ssx=true;open();await loaded();expect(state.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Reavaliar rastreamento'}));
    await waitFor(()=>expect(state.invoke).toHaveBeenCalledWith('update-trip-live-status',{body:{tenant_id:i.tenant}}));
    await waitFor(()=>expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Rastreamento reavaliado'})));
  });
  it('renders an actual SQL evaluation and invalidates it after the operation changes a stop',async()=>{
    state.ssx=true;await db.exec('update tenant_feature_policy set enabled=true');
    await db.query("insert into positions_last(tenant_id,vehicle_id,lat,lng,speed,captured_at,received_at) values($1,$2,-23.1,-46.1,30,statement_timestamp()-interval '1 minute',statement_timestamp())",[i.tenant,i.vehicle]);
    state.invoke.mockImplementation(()=>{
      const task=serial.then(async()=>{
        await db.exec('savepoint ui_evaluation;set local role authenticated');
        try{const result=await db.query<{value:unknown}>('select evaluate_trip_live_status_v1($1,$2) value',[i.tenant,i.trip]);await db.exec('reset role;release ui_evaluation');return {data:result.rows[0].value,error:null};}
        catch(error){await db.exec('rollback to ui_evaluation;release ui_evaluation');return {data:null,error};}
      });serial=task.then(()=>undefined);return task;
    });
    open();await loaded();expect(screen.getByRole('button',{name:/QA-1234/})).toHaveTextContent('Aguardando avaliação');
    fireEvent.click(screen.getByRole('button',{name:'Reavaliar rastreamento'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:/QA-1234/})).toHaveTextContent('Em rota'));
    await serial;await db.query("update dispatch_stops set status='arrived' where id=$1",[i.stop]);
    await client.invalidateQueries({queryKey:['active-trips-live']});
    await waitFor(()=>expect(screen.getByRole('button',{name:/QA-1234/})).toHaveTextContent('Aguardando avaliação'));
  });
});
