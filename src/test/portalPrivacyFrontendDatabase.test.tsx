import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import PortalShipmentDetail from '@/pages/portal/PortalShipmentDetail';
import {createPortalPrivacyDatabase,portalDetail,portalPrivacyIds as i} from './helpers/portalPrivacyDatabase';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({actor:'' as string|undefined,tenant:'' as string|undefined,rpc:vi.fn(),v2Error:null as {code:string;message:string}|null,tamper:''}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:mock.actor?{id:mock.actor}:null})}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:mock.tenant?{id:mock.tenant}:null})}));
vi.mock('@/hooks/portal/usePortalPods',()=>({useDownloadPortalPod:()=>({mutateAsync:vi.fn()})}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:vi.fn()})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc}}));
let db:PGlite;let client:QueryClient;
beforeAll(async()=>{db=await createPortalPrivacyDatabase(true);},30000);afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 vi.clearAllMocks();mock.actor=i.user;mock.tenant=i.tenant;mock.v2Error=null;mock.tamper='';await db.exec('begin');
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 mock.rpc.mockImplementation((name:string)=>({abortSignal:async(signal:AbortSignal)=>{
  expect(signal).toBeDefined();if(name.endsWith('_v2')&&mock.v2Error)return {data:null,error:mock.v2Error};
  try{const data=await portalDetail(db,name.endsWith('_v2')?'v2':'v1');
   if(mock.tamper)data.context={...(data.context as Record<string,unknown>),[mock.tamper]:i.otherUser};
   return {data,error:null};
  }catch(error){return {data:null,error};}
 }}));
});
afterEach(async()=>{cleanup();client.clear();await db.exec('rollback');});
const Page=()=> <QueryClientProvider client={client}><MemoryRouter initialEntries={['/portal/shipments/'+i.doc]}><Routes><Route path="/portal/shipments/:documentId" element={<PortalShipmentDetail/>}/></Routes></MemoryRouter></QueryClientProvider>;
const tab=(name:string)=>{const element=screen.getByRole('tab',{name});fireEvent.mouseDown(element,{button:0,ctrlKey:false});fireEvent.click(element);};
describe('real portal page/hook to local privacy SQL (not authenticated HTTP E2E)',()=>{
 it('renders transport milestones and published notice without private event notes or another client notice',async()=>{
  render(<Page/>);await screen.findByRole('heading',{name:'NF PORTAL-A'});tab('Timeline');await screen.findByText('Viagem iniciada');
  expect(screen.getByText('Chegou ao destino')).toBeInTheDocument();expect(screen.getByText('Aviso público desta nota')).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/QA-NOTA-INTERNA|QA-OCORRENCIA-INTERNA|QA-OCORRENCIA-OUTRO-CLIENTE/);
  tab('Ocorrências (1)');await screen.findByText('Aviso público desta nota');expect(document.body.textContent).not.toContain('QA-OCORRENCIA-OUTRO-CLIENTE');
 });
 it.each(['42501','P0001','57014','NETWORK_ERROR'])('does not fall back to legacy after %s',async(code)=>{
  mock.v2Error={code,message:'Consulta recusada QA'};render(<Page/>);await screen.findByText('Documento não disponível');
  expect(mock.rpc.mock.calls.map(([name])=>name)).toEqual(['get_client_portal_shipment_detail_v2']);expect(screen.queryByText('NF PORTAL-A')).not.toBeInTheDocument();
 });
 it('can retry a read failure without changing endpoint or performing writes',async()=>{
  mock.v2Error={code:'57014',message:'Leitura temporariamente indisponível'};render(<Page/>);await screen.findByText('Documento não disponível');
  mock.v2Error=null;fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));await screen.findByRole('heading',{name:'NF PORTAL-A'});
  expect(mock.rpc.mock.calls.map(([name])=>name)).toEqual(['get_client_portal_shipment_detail_v2','get_client_portal_shipment_detail_v2']);
 });
 it('uses only the hardened legacy contract when the v2 RPC is missing',async()=>{
  mock.v2Error={code:'PGRST202',message:'get_client_portal_shipment_detail_v2 not found'};render(<Page/>);await screen.findByRole('heading',{name:'NF PORTAL-A'});
  expect(mock.rpc.mock.calls.map(([name])=>name)).toEqual(['get_client_portal_shipment_detail_v2','get_client_portal_shipment_detail']);
  expect(document.body.textContent).not.toMatch(/QA-NOTA-INTERNA|QA-OCORRENCIA-OUTRO-CLIENTE/);
 });
 it.each(['actor_id','tenant_id','document_id'])('refuses a response for a different %s',async(field)=>{
  mock.tamper=field;render(<Page/>);await screen.findByText('Documento não disponível');expect(screen.queryByText('NF PORTAL-A')).not.toBeInTheDocument();expect(mock.rpc).toHaveBeenCalledTimes(1);
 });
 it('does not display cached document details after actor changes',async()=>{
  const view=render(<Page/>);await screen.findByRole('heading',{name:'NF PORTAL-A'});
  mock.actor=i.otherUser;await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.otherUser]);view.rerender(<Page/>);
  expect(screen.queryByText('NF PORTAL-A')).not.toBeInTheDocument();await screen.findByText('Documento não disponível');expect(mock.rpc).toHaveBeenCalledTimes(2);
 });
 it('does not display cached document details in another selected tenant',async()=>{
  const view=render(<Page/>);await screen.findByRole('heading',{name:'NF PORTAL-A'});mock.tenant=i.otherTenant;view.rerender(<Page/>);
  expect(screen.queryByText('NF PORTAL-A')).not.toBeInTheDocument();await screen.findByText('Documento não disponível');
 });
 it('clears the visible document on logout and does not perform an anonymous read',async()=>{
  const view=render(<Page/>);await screen.findByRole('heading',{name:'NF PORTAL-A'});mock.actor=undefined;view.rerender(<Page/>);
  expect(screen.queryByText('NF PORTAL-A')).not.toBeInTheDocument();await waitFor(()=>expect(mock.rpc).toHaveBeenCalledTimes(1));
 });
});
