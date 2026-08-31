import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import PortalShipmentDetail from '@/pages/portal/PortalShipmentDetail';
import {createProofVersionDatabase,seedHistoricalProof,authorizeProofPortalViewer} from './helpers/proofVersionDatabase';
import {operationIds as i,operationPayload,recordOperation,operationRpc} from './helpers/operationOutcomeDatabase';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({rpc:vi.fn(),download:vi.fn(),toast:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:i.operator}})}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:i.tenant}})}));
vi.mock('@/hooks/portal/usePortalPods',()=>({useDownloadPortalPod:()=>({mutateAsync:mock.download,isPending:false})}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:mock.toast})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc}}));
let db:PGlite;let stop:string;let trip:string;let client:QueryClient;let oldId:string;let currentId:string;
beforeAll(async()=>{({db,stop,trip}=await createProofVersionDatabase());},30000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 vi.clearAllMocks();await db.exec('begin');oldId=(await seedHistoricalProof(db,trip,stop)).proof;
 currentId=(await recordOperation(db,await operationPayload(db,stop))).pod_id as string;
 await authorizeProofPortalViewer(db);await db.query("update fiscal_documents set invoice_number='VERSOES-QA' where id=$1",[i.doc]);
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 mock.rpc.mockImplementation((name:string,args:{_fiscal_document_id:string})=>({abortSignal:async()=>{
  try{return {data:(await operationRpc(db,`select public.${name}($1) result`,[args._fiscal_document_id])).rows[0].result,error:null};}
  catch(error){return {data:null,error};}
 }}));
 mock.download.mockImplementation(async(id:string)=>{
  const rows=(await operationRpc(db,'select * from get_client_pod_metadata($1,$2)',[i.tenant,id])).rows;
  if(!rows[0]?.storage_path)throw new Error('Comprovante não disponível');
  return 'https://example.invalid/signed-proof';
 });
 vi.spyOn(window,'open').mockImplementation(()=>null);
});
afterEach(async()=>{cleanup();client.clear();vi.restoreAllMocks();await db.exec('rollback');});
const show=()=>render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/portal/shipments/'+i.doc]}><Routes><Route path="/portal/shipments/:documentId" element={<PortalShipmentDetail/>}/></Routes></MemoryRouter></QueryClientProvider>);
async function openProofs(){show();await screen.findByRole('heading',{name:'NF VERSOES-QA'});const tab=screen.getByRole('tab',{name:'Canhotos'});fireEvent.mouseDown(tab,{button:0,ctrlKey:false});fireEvent.click(tab);return await screen.findByRole('region',{name:'Versões anteriores dos comprovantes'});}
describe('real portal proof-version page, hook and SQL (not hosted browser E2E)',()=>{
 it('separates a pending current receipt from the downloadable previous version',async()=>{
  const history=await openProofs();const current=screen.getByRole('region',{name:'Comprovantes atuais'});
  expect(within(current).getByText('Comprovante atual — versão 2')).toBeInTheDocument();
  expect(within(current).getByText('Arquivo pendente')).toBeInTheDocument();expect(within(current).queryByRole('button')).not.toBeInTheDocument();
  expect(within(history).getByText('Comprovante anterior — versão 1')).toBeInTheDocument();
  expect(within(history).getByText(/Não confirma a tentativa atual/)).toBeInTheDocument();
  expect(screen.getByText('Canhoto pendente')).toBeInTheDocument();
 });
 it('downloads the original proof ID rather than the new pending proof',async()=>{
  await openProofs();fireEvent.click(screen.getByRole('button',{name:'Baixar comprovante anterior versão 1'}));
  await waitFor(()=>expect(window.open).toHaveBeenCalledWith('https://example.invalid/signed-proof','_blank','noopener,noreferrer'));
  expect(mock.download).toHaveBeenCalledWith(oldId);expect(mock.download).not.toHaveBeenCalledWith(currentId);
 });
 it('handles a revoked download permission without opening a window or losing proof history',async()=>{
  await openProofs();await db.exec('update client_portal_access set can_download_documents=false');
  fireEvent.click(screen.getByRole('button',{name:'Baixar comprovante anterior versão 1'}));
  await waitFor(()=>expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Erro ao baixar',variant:'destructive'})));
  expect(window.open).not.toHaveBeenCalled();expect(screen.getByText('Comprovante anterior — versão 1')).toBeInTheDocument();
 });
 it('does not offer historical download when the server permissions disallow it',async()=>{
  await db.exec('update client_portal_access set can_download_documents=false');await openProofs();
  expect(screen.queryByRole('button',{name:/Baixar comprovante/})).not.toBeInTheDocument();
 });
});
