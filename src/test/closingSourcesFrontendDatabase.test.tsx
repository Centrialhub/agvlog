import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {ClosingAttemptPreviewPanel} from '@/components/closingReports/ClosingAttemptPreviewPanel';
import {createClosingSourcesDatabase,closingSources,closingSourceFilters,seedClosingCte} from './helpers/closingSourcesDatabase';
import {operationIds as i} from './helpers/operationOutcomeDatabase';
import {seedUndelivered} from './helpers/deliveryAttemptDatabase';
import {requestRedelivery,redeliveryPayload} from './helpers/redeliveryDatabase';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),tenant:'',actor:'',incomplete:false,delay:false,release:null as null|(()=>void)}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:mock.tenant}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:mock.actor}})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:mock.from}}));
let db:PGlite;let stop:string;let client:QueryClient;let transport:Promise<unknown>=Promise.resolve();
beforeAll(async()=>{({db,stop}=await createClosingSourcesDatabase());},30000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 vi.clearAllMocks();mock.tenant=i.tenant;mock.actor=i.operator;mock.incomplete=false;mock.delay=false;mock.release=null;
 await db.exec('begin');await db.query("update fiscal_documents set invoice_number=case when id=$1 then '111' when id=$2 then '222' else '333' end",[i.doc,i.doc2]);
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 mock.from.mockImplementation(()=>{throw new Error('Unexpected direct closing table access');});
 mock.rpc.mockImplementation((name:string,args:{_tenant_id:string;_filters:Record<string,unknown>})=>({abortSignal:()=>{
  const actor=mock.actor;const work=async()=>{try{
   if(name!=='get_closing_report_sources')throw new Error('Unexpected write/RPC '+name);
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
   const data=await closingSources(db,args._filters,args._tenant_id) as Record<string,unknown>;
   if(mock.incomplete)data.complete=false;
   if(mock.delay){mock.delay=false;await new Promise<void>(resolve=>{mock.release=resolve;});}
   return {data,error:null};
  }catch(error){return {data:null,error};}};
  const pending=transport.then(work,work);transport=pending;return pending;
 }}));
});
afterEach(async()=>{mock.release?.();cleanup();client.clear();await transport;await db.exec('rollback');});
function Story({filters=closingSourceFilters,allocation='per_nf' as 'per_nf'|'cte_by_value',onlyWithCte=false}={}){
 return <QueryClientProvider client={client}><ClosingAttemptPreviewPanel filters={filters} allocation={allocation} onlyWithCte={onlyWithCte}/></QueryClientProvider>;
}
describe('read-only closing UI against real local PostgreSQL',{timeout:15000},()=>{
 it('shows distinct attempts and retained original freight without writing a report or financial record',async()=>{
  await seedUndelivered(db,stop);await requestRedelivery(db,await redeliveryPayload(db));render(<Story/>);
  await screen.findByText('4 tentativa(s), 3 nota(s) distinta(s).');
  const rows=screen.getAllByRole('row').filter(row=>within(row).queryByRole('rowheader',{name:'111'}));expect(rows).toHaveLength(2);
  const historical=rows.find(row=>row.textContent?.includes('histórica'))!;const current=rows.find(row=>row.textContent?.includes('Reentrega'))!;
  expect(within(historical).getByText('Devolvida')).toBeInTheDocument();expect(within(current).getByText('Sem resultado auditado')).toBeInTheDocument();
  expect(within(current).getByText(/12 kg · saldo reservado/)).toBeInTheDocument();expect(within(current).getByText('Não confirmados')).toBeInTheDocument();
  expect(screen.getByText(/Não cria relatório, não fatura/)).toBeInTheDocument();
  expect(mock.from).not.toHaveBeenCalled();expect(mock.rpc.mock.calls.every(([name])=>name==='get_closing_report_sources')).toBe(true);
 });
 it('renders the proportional share from the complete CT-e universe',async()=>{
  await db.query("update fiscal_documents set issue_date='2026-07-01' where id=$1",[i.doc2]);await seedClosingCte(db);
  render(<Story allocation="cte_by_value" onlyWithCte/>);await screen.findByText('1 tentativa(s), 1 nota(s) distinta(s).');
  expect(screen.getByText(/Frete das tentativas: R\$\s*50,00/)).toBeInTheDocument();expect(screen.queryByRole('rowheader',{name:'222'})).not.toBeInTheDocument();
 });
 it('never displays an incomplete response as a financial total, and permits an explicit retry',async()=>{
  mock.incomplete=true;render(<Story/>);await screen.findByRole('alert');expect(screen.queryByRole('table')).not.toBeInTheDocument();
  mock.incomplete=false;fireEvent.click(screen.getByRole('button',{name:'Consultar novamente'}));await screen.findByRole('table');
  expect(mock.rpc).toHaveBeenCalledTimes(2);
 });
 it('removes prior tenant data immediately and refuses a delayed response for the previous company',async()=>{
  mock.delay=true;const view=render(<Story/>);await waitFor(()=>expect(mock.release).not.toBeNull());
  mock.tenant=i.otherTenant;view.rerender(<Story/>);expect(screen.queryByRole('table')).not.toBeInTheDocument();mock.release?.();
  await screen.findByText('Sua sessão não tem permissão para consultar este fechamento.');expect(screen.queryByRole('table')).not.toBeInTheDocument();
 });
 it('does not reuse an operator preview after switching to a driver session',async()=>{
  const view=render(<Story/>);await screen.findByRole('table');mock.actor=i.user;view.rerender(<Story/>);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();await screen.findByText('Sua sessão não tem permissão para consultar este fechamento.');
 });
 it('rejects invalid periods before sending any request',async()=>{
  render(<Story filters={{period_start:'2026-08-31',period_end:'2026-08-01'}}/>);
  expect(screen.getByRole('alert')).toHaveTextContent('Informe um período válido');expect(mock.rpc).not.toHaveBeenCalled();
 });
});
