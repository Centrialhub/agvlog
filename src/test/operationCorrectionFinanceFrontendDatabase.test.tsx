import {createDeliveryAttemptDatabase} from './helpers/deliveryAttemptDatabase';
import {createRedeliveryDatabase} from './helpers/redeliveryDatabase';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {DriverSettlementDrawer} from '@/components/financial/DriverSettlementDrawer';
import {createCorrectionDatabase,seedCorrectableOutcome,correctOperation,correctionPayload} from './helpers/operationCorrectionDatabase';

vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({data:undefined as unknown,payment:vi.fn(),zero:vi.fn(),status:vi.fn(),regen:vi.fn(),other:vi.fn(),signed:vi.fn()}));
vi.mock('@/hooks/useDriverSettlements',async(importOriginal)=>{
 const actual=await importOriginal<typeof import('@/hooks/useDriverSettlements')>();
 const mutation=(fn:typeof mock.payment)=>({mutate:fn,mutateAsync:fn,isPending:false});
 return {...actual,useDriverSettlement:()=>({data:mock.data,isLoading:false}),
  useRegenerateDriverSettlement:()=>mutation(mock.regen),useUpdateDriverSettlementStatus:()=>mutation(mock.status),
  useRegisterSettlementPayment:()=>mutation(mock.payment),useSettleZeroDriverSettlement:()=>mutation(mock.zero),
  useUpdateSettlementKmReview:()=>mutation(mock.other),useAddSettlementAdjustment:()=>mutation(mock.other),
  useRemoveSettlementAdjustment:()=>mutation(mock.other),useDetachLoadFromSettlement:()=>mutation(mock.other),
  useAddSettlementManualExpense:()=>mutation(mock.other),useDeleteDriverSettlement:()=>mutation(mock.other)};
});
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>{throw new Error('Unexpected hosted financial access in local test');},storage:{from:()=>({createSignedUrl:mock.signed})}}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'10000000-0000-4000-8000-000000000011'}})}));
vi.mock('@/hooks/useCostCenters',()=>({useCostCenters:()=>({data:[]})}));
vi.mock('@/hooks/useBankReconciliation',()=>({useBankAccounts:()=>({data:[]})}));
vi.mock('@/components/financial/AttachLoadsDialog',()=>({default:()=>null}));
afterAll(()=>vi.unstubAllGlobals());
describe.each(['previous','attempt-foundation','redelivery'] as const)('schema: %s',stage=>{
let db:PGlite;let stop:string;let id:string;
beforeAll(async()=>{({db,stop}=await (stage==='redelivery'?createRedeliveryDatabase():stage==='attempt-foundation'?createDeliveryAttemptDatabase():createCorrectionDatabase()));},30000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{
 vi.clearAllMocks();mock.signed.mockResolvedValue({data:{signedUrl:'https://example.invalid/receipt.png'},error:null});await db.exec('begin');await seedCorrectableOutcome(db,stop,true);
 id=(await db.query<{id:string}>("update driver_settlements set status='approved' returning id")).rows[0].id;
});
afterEach(async()=>{cleanup();await db.exec('rollback');});
async function refresh(){
 mock.data=(await db.query<{data:unknown}>(`select jsonb_build_object(
  'settlement',(select to_jsonb(s) from driver_settlements s where id=$1),
  'items',coalesce((select jsonb_agg(to_jsonb(i)) from driver_settlement_items i where settlement_id=$1),'[]'),
  'events',coalesce((select jsonb_agg(to_jsonb(e)) from driver_settlement_events e where settlement_id=$1),'[]'),
  'payments',coalesce((select jsonb_agg(to_jsonb(p)) from driver_settlement_payments p where settlement_id=$1),'[]')) data`,[id])).rows[0].data;
}
const drawer=()=> <DriverSettlementDrawer settlementId={id} open onOpenChange={()=>{}}/>;
const correct=async()=>{await correctOperation(db,await correctionPayload(db,stop));await refresh();};

describe('rendered financial drawer with SQL-produced correction state',()=>{
 it('disables payment and zero settlement while showing why the existing values were preserved',async()=>{
  await correct();render(drawer());
  expect(screen.getByText(/Resultado de entrega corrigido. Valores e pagamentos anteriores preservados/)).toBeVisible();
  const pay=screen.getByRole('button',{name:'Registrar pagamento'}),zero=screen.getByRole('button',{name:'Quitar sem pagamento'});
  expect(pay).toBeDisabled();expect(zero).toBeDisabled();fireEvent.click(pay);fireEvent.click(zero);
  expect(mock.payment).not.toHaveBeenCalled();expect(mock.zero).not.toHaveBeenCalled();
 });
 it('disables an already-open payment confirmation if a correction arrives after the dialog opens',async()=>{
  await db.exec('update driver_settlements set driver_payable_amount=250');await refresh();const view=render(drawer());
  fireEvent.click(screen.getByRole('button',{name:'Registrar pagamento'}));const dialog=await screen.findByRole('dialog',{name:'Registrar pagamento'});
  expect(within(dialog).getByLabelText(/Valor pago/)).toBeVisible();
  const confirm=within(dialog).getByRole('button',{name:'Registrar'});await waitFor(()=>expect(confirm).toBeEnabled());
  await correct();view.rerender(drawer());expect(confirm).toBeDisabled();fireEvent.click(confirm);expect(mock.payment).not.toHaveBeenCalled();
 });
 it('disables an already-open zero-settlement confirmation when a correction arrives',async()=>{
  await refresh();const view=render(drawer());fireEvent.click(screen.getByRole('button',{name:'Quitar sem pagamento'}));
  const dialog=await screen.findByRole('dialog',{name:'Quitar sem pagamento'});
  fireEvent.change(within(dialog).getByLabelText(/Motivo da quitação sem pagamento/),{target:{value:'Sem saldo conferido'}});
  const confirm=within(dialog).getByRole('button',{name:'Quitar'});expect(confirm).toBeEnabled();
  await correct();view.rerender(drawer());expect(confirm).toBeDisabled();fireEvent.click(confirm);expect(mock.zero).not.toHaveBeenCalled();
 });
 it('prevents approval, including exception approval, until the correction is reviewed',async()=>{
  await db.exec("update driver_settlements set status='in_review'");await correct();render(drawer());
  expect(screen.getByRole('button',{name:'Aprovar'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Aprovar c/ exceção'})).toBeDisabled();expect(mock.status).not.toHaveBeenCalled();
 });
 it('prevents paid settlement closure but keeps explicit reopening available',async()=>{
  await db.exec("update driver_settlements set status='paid'");await correct();render(drawer());
  expect(screen.getByRole('button',{name:'Fechado'})).toBeDisabled();
  const reopen=screen.getByRole('button',{name:'Reaberto'});expect(reopen).toBeEnabled();fireEvent.click(reopen);
  expect(mock.status).toHaveBeenCalledWith({id,status:'reopened'});
 });
 it('shows the translated correction event without inventing a payment in the history',async()=>{
  await correct();render(drawer());fireEvent.mouseDown(screen.getByRole('tab',{name:/Histórico/}),{button:0,ctrlKey:false});
  expect(await screen.findByText('Resultado de entrega corrigido',{exact:true})).toBeVisible();
  expect(screen.getByRole('tab',{name:'Pagamentos (0)'})).toBeVisible();
 });
 it('keeps the ordinary approved settlement payment path enabled before any correction',async()=>{
  await refresh();render(drawer());expect(screen.queryByText(/Resultado de entrega corrigido/)).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Registrar pagamento'})).toBeEnabled();expect(screen.getByRole('button',{name:'Quitar sem pagamento'})).toBeEnabled();
 });
 it('opens the expense receipt through signed access and hides it when another statement is selected',async()=>{
  const tenant=(await db.query<{tenant_id:string}>('select tenant_id from driver_settlements where id=$1',[id])).rows[0].tenant_id,path=tenant+'/expenses/qa-receipt.png';
  await db.query("insert into driver_settlement_items(tenant_id,settlement_id,item_type,description,amount,metadata) values($1,$2,'expense','Comprovante QA',25,$3::jsonb)",[tenant,id,JSON.stringify({receipt_url:path,approval_status:'pending'})]);
  await refresh();const view=render(drawer());fireEvent.mouseDown(screen.getByRole('tab',{name:/Despesas/}),{button:0,ctrlKey:false});
  fireEvent.click(await screen.findByRole('button',{name:'Abrir comprovante da despesa'}));await screen.findByRole('img',{name:'Comprovante da despesa selecionada'});
  expect(mock.signed).toHaveBeenCalledWith(path,300);
  id=(await db.query<{id:string}>("insert into driver_settlements(tenant_id,driver_id,status,is_manual) select tenant_id,driver_id,'pending_review',true from driver_settlements where id=$1 returning id",[id])).rows[0].id;
  await refresh();view.rerender(drawer());expect(screen.queryByRole('dialog',{name:'Comprovante da despesa'})).not.toBeInTheDocument();
 });
});
});
