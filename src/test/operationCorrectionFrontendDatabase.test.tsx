import {createDeliveryAttemptDatabase} from './helpers/deliveryAttemptDatabase';
import {createRedeliveryDatabase} from './helpers/redeliveryDatabase';
import {createDocumentMetadataDatabase,metadataPayload,updateMetadata} from './helpers/documentMetadataDatabase';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';import type {ComponentProps} from 'react';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import LoadNotesPanel from '@/components/loads/LoadNotesPanel';
import {OperationOutcomeRecoveryPanel} from '@/components/loads/OperationOutcomeRecoveryPanel';
import {createCorrectionDatabase,seedCorrectableOutcome,correctOperation} from './helpers/operationCorrectionDatabase';
import {operationIds as i,operationRpc,operationPayload,recordOperation} from './helpers/operationOutcomeDatabase';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({rpc:vi.fn(),success:vi.fn(),error:vi.fn(),loseReply:false}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:i.tenant}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:i.operator}})}));
vi.mock('@/hooks/useSonnerToast',()=>({useSonnerToast:()=>({success:mock.success,error:mock.error,info:vi.fn()})}));
vi.mock('@/lib/printLoadNotes',()=>({printLoadNotesReport:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:()=>{throw new Error('Unexpected direct write in correction UI');}}}));
afterAll(()=>vi.unstubAllGlobals());
describe.each(['previous','attempt-foundation','redelivery','metadata'] as const)('schema: %s',stage=>{
let db:PGlite;let stop:string;let client:QueryClient;
beforeAll(async()=>{({db,stop}=await (stage==='metadata'?createDocumentMetadataDatabase():stage==='redelivery'?createRedeliveryDatabase():stage==='attempt-foundation'?createDeliveryAttemptDatabase():createCorrectionDatabase()));},30000);afterAll(async()=>{await db?.close();});
beforeEach(async()=>{
 vi.clearAllMocks();mock.loseReply=false;localStorage.clear();await db.exec('begin');
 await db.query("update fiscal_documents set invoice_number=case when id=$1 then '111' else '222' end where load_id=$2",[i.doc,i.load]);
 await seedCorrectableOutcome(db,stop);client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_key:string,work:()=>Promise<unknown>)=>work()}});
 mock.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>({abortSignal:async()=>{
  try{
   const data=name==='get_operation_document_context'?(await operationRpc(db,'select get_operation_document_context($1,$2,$3) result',[args._tenant_id,args._load_id,args._document_id])).rows[0].result
    :name==='record_operation_document_correction'?await correctOperation(db,args._payload):await recordOperation(db,args._payload);
   if(name==='record_operation_document_correction'&&mock.loseReply){mock.loseReply=false;return {data:{},error:null};}
   return {data,error:null};
  }catch(error){return {data:null,error};}
 }}));
});
afterEach(async()=>{cleanup();client.clear();await db.exec('rollback');});
function Panel(){const rows=useQuery({queryKey:['load_documents',i.load],queryFn:async()=>(await db.query('select * from fiscal_documents where load_id=$1 order by invoice_number',[i.load])).rows});
 const props={load:{id:i.load,load_number:'1003'},documents:rows.data||[]} as unknown as ComponentProps<typeof LoadNotesPanel>;
 return rows.data?<LoadNotesPanel {...props}/>:null;
}
const show=(panel=true)=>render(<QueryClientProvider client={client}><OperationOutcomeRecoveryPanel/>{panel?<Panel/>:null}</QueryClientProvider>);
async function open(){fireEvent.click((await screen.findAllByRole('button',{name:'Corrigir resultado'}))[0]);return await screen.findByRole('dialog');}
async function fill(dialog:HTMLElement,outcome='not_delivered'){
 const select=within(dialog).getByLabelText('Novo resultado');await waitFor(()=>expect(select).toBeEnabled());fireEvent.change(select,{target:{value:outcome}});
 fireEvent.change(within(dialog).getByLabelText('Parada do resultado'),{target:{value:stop}});
 // A completed trip cannot accept the wall-clock time of a later test action.
 // Reuse the recorded occurrence, just as the operator must provide its real time.
 const recorded=(await db.query<{occurred_at:Date}>('select occurred_at from current_delivery_document_outcomes where fiscal_document_id=$1',[i.doc])).rows[0].occurred_at;
 const t=new Date(recorded);const local=localMinute(t);
 fireEvent.change(within(dialog).getByLabelText('Data e hora reais do resultado corrigido'),{target:{value:local}});
 if(['delivered','partial_delivery'].includes(outcome))fireEvent.change(within(dialog).getByLabelText('Nome do recebedor'),{target:{value:'Recebedor corrigido'}});
 fireEvent.change(within(dialog).getByLabelText('Motivo e fonte da correção'),{target:{value:'Documento conferido com recebedor pela operação'}});
}
function localMinute(t:Date){const pad=(n:number)=>String(n).padStart(2,'0');return `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;}
const writes=()=>mock.rpc.mock.calls.filter(([name])=>name==='record_operation_document_correction');
describe('real correction screen, recoverable request and SQL',()=>{
 it('replaces direct unmarking with an explicit audited result and keeps the invoice in its load',async()=>{
  show();const dialog=await open();expect(within(dialog).getByRole('button',{name:'Confirmar correção'})).toBeDisabled();expect(writes()).toHaveLength(0);
  await fill(dialog);fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar correção'}));
  await waitFor(()=>expect(mock.success).toHaveBeenCalledWith('Correção registrada com histórico preservado.'));
  expect((await db.query('select status,load_id from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({status:'not_delivered',load_id:i.load});
  expect((await db.query('select count(*)::int n from delivery_document_outcomes')).rows[0]).toEqual({n:2});expect(localStorage.length).toBe(0);
 });
 it('recovers a committed correction after remount without resending it as an ordinary confirmation',async()=>{
  mock.loseReply=true;const view=show();const dialog=await open();await fill(dialog,'delivered');fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar correção'}));
  await within(dialog).findByText(/O servidor não confirmou/);expect(mock.success).not.toHaveBeenCalled();const original=writes()[0][1];
  expect(JSON.parse(localStorage.getItem(localStorage.key(0)!)!).version).toBe(2);
  view.unmount();show(false);fireEvent.click(await screen.findByRole('button',{name:'Recuperar resultado'}));await screen.findByText('Correção registrada; comprovante pendente.');
  expect(writes()[1][1]).toEqual(original);expect(mock.rpc.mock.calls.some(([name])=>name==='record_operation_document_outcome')).toBe(false);
  expect((await db.query('select count(*)::int n from delivery_document_corrections')).rows[0]).toEqual({n:1});expect(localStorage.length).toBe(0);
 });
 it('retains the reason but requires explicit reselection after a stale-context rejection',async()=>{
  show();const dialog=await open();await fill(dialog);if(stage==='metadata')await updateMetadata(db,await metadataPayload(db));else await db.query("update fiscal_documents set delivery_meta=delivery_meta||'{\"payment_method\":\"pix\"}' where id=$1",[i.doc]);
  fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar correção'}));await within(dialog).findByText(/A nota, parada ou comprovante mudou/);
  expect(within(dialog).getByLabelText('Motivo e fonte da correção')).toHaveValue('Documento conferido com recebedor pela operação');
  await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Confirmar correção'})).toBeDisabled());expect(mock.success).not.toHaveBeenCalled();
 });
 it('requires explicit quantities for a partial correction and shows the corrected status',async()=>{
  show();const dialog=await open();await fill(dialog,'partial_delivery');fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar correção'}));
  await within(dialog).findByText(/solicitação válida/);expect(writes()).toHaveLength(0);
  fireEvent.change(within(dialog).getByLabelText(/devolvido \(total/),{target:{value:'0.5'}});fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar correção'}));
  await waitFor(()=>expect(mock.success).toHaveBeenCalledWith('Correção registrada; comprovante pendente.'));await screen.findByText('Entrega parcial');
 });
 it('announces preserved financial values and required review after correction in a completed trip',async()=>{
  const second=await operationPayload(db,stop,i.doc2);second.request_id=i.request2;await recordOperation(db,second);
  show();const dialog=await open();await fill(dialog);fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar correção'}));
  await waitFor(()=>expect(mock.success).toHaveBeenCalledWith('Correção registrada; acerto preservado e sinalizado para revisão.'));
  expect((await db.query('select needs_recalculation from driver_settlements')).rows[0]).toEqual({needs_recalculation:true});
  expect((await db.query('select count(*)::int n from driver_settlement_payments')).rows[0]).toEqual({n:0});
 });
 it('explains the recorded end-of-trip limit and preserves the draft when an invalid later time is submitted',async()=>{
  const second=await operationPayload(db,stop,i.doc2);second.request_id=i.request2;await recordOperation(db,second);
  const end=(await db.query<{actual_end_at:Date}>('select actual_end_at from dispatch_trips')).rows[0].actual_end_at;
  show();const dialog=await open();await fill(dialog);
  fireEvent.change(within(dialog).getByLabelText('Data e hora reais do resultado corrigido'),{target:{value:localMinute(new Date(new Date(end).getTime()+60_000))}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar correção'}));await within(dialog).findByText(/até o fim registrado da viagem/);
  expect(within(dialog).getByLabelText('Motivo e fonte da correção')).toHaveValue('Documento conferido com recebedor pela operação');
  expect(mock.success).not.toHaveBeenCalled();expect((await db.query('select count(*)::int n from delivery_document_corrections')).rows[0]).toEqual({n:0});
 });
});
});
