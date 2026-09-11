// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {createUnloadingBankPackageDatabase} from './helpers/unloadingBankPackageDatabase';
import {seedAccountCloseStatement} from './helpers/accountPeriodCloseDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {periodUnloadingFlowSchema} from '@/lib/financial/periodUnloadingFlowContract';
import {periodMoneyPackageSchema} from '@/lib/financial/periodMoneyPackageContract';
let db:Awaited<ReturnType<typeof createUnloadingBankPackageDatabase>>;
beforeAll(async()=>{db=await createUnloadingBankPackageDatabase();},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
const scope={account_id:i.account,from:'2026-08-01',to:'2026-08-31'};
const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Conferência integrada de descarga e banco'});
async function rpc<T>(name:string,args:unknown[]){return(await financeAs<{v:T}>(db,i.operator,`select ${name}(${args.map((_,index)=>'$'+(index+1)).join(',')}) v`,args)).rows[0].v;}
async function receive(title:string,cents:number,movement:string){
 const context=await rpc<{revision:string}>('get_receivable_financial_context',[i.tenant,title]);
 return rpc('apply_receivable_financial_command',[{...base(),actor_id:i.operator,receivable_id:title,expected_revision:context.revision,action:'receive',amount_cents:cents,effective_date:'2026-08-10',bank_account_id:i.account,method:'pix',movement_id:movement}]);
}
async function charge(){
 const supplier=randomUUID(),trip=randomUUID(),stop=randomUUID(),doc=randomUUID();
 await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Fornecedor preservado',true)",[supplier,i.tenant]);
 await db.query("insert into dispatch_trips(id,tenant_id,status) values($1,$2,'completed')",[trip,i.tenant]);
 await db.query("insert into dispatch_stops(id,tenant_id,dispatch_trip_id,stop_order,status,client_id,destination) values($1,$2,$3,1,'completed',$4,'Sede do cliente')",[stop,i.tenant,trip,supplier]);
 await db.query("insert into fiscal_documents(id,tenant_id,client_id,supplier_id,document_type,status) values($1,$2,$3,$3,'inbound','ready')",[doc,i.tenant,supplier]);
 await db.query('insert into dispatch_stop_documents(tenant_id,dispatch_stop_id,fiscal_document_id) values($1,$2,$3)',[i.tenant,stop,doc]);
 const context=await rpc<{revision:string;issue:string|null}>('get_finance_delivery_context',[i.tenant,stop]);expect(context.issue).toBeNull();
 const receipt=i.tenant+'/receipts/descarga.pdf';await db.query("insert into storage.objects(bucket_id,name,metadata) values('receipts',$1,'{\"mimetype\":\"application/pdf\",\"size\":100}')",[receipt]);
 const result=await rpc<{receivable_id:string;charge_id:string}>('record_finance_unloading',[{...base(),stop_id:stop,expected_revision:context.revision,amount_cents:15000,occurred_on:'2026-08-02',due_date:'2026-08-20',receipt_path:receipt}]);
 return{...result,supplier};
}
it('links a real shared receipt to an actual bank closure once and removes coverage after reopening',async()=>{
 const origin=await charge();
 const freight=(await db.query<{id:string}>("insert into receivables(tenant_id,client_id,amount,received_amount,status,description) values($1,$2,200,0,'pending','Frete no mesmo PIX') returning id",[i.tenant,origin.supplier])).rows[0].id;
 const movement=await rpc<{movement_id:string}>('record_finance_movement',[{...base(),bank_account_id:i.account,direction:'in',nature:'receipt',amount_cents:30000,occurred_on:'2026-08-10',description:'PIX único descarga e frete',beneficiary_name:'Fornecedor preservado'}]);
 await receive(origin.receivable_id,10000,movement.movement_id);await receive(freight,20000,movement.movement_id);
 await seedAccountCloseStatement(db,'2026-07-31',10000);
 const statement=await seedAccountCloseStatement(db,'2026-08-31',40000,scope.from,scope.to,[{day:'2026-08-10',cents:30000}]);
 await db.exec('select finance_private.run_automatic_reconciliation_queue()');
 const reconciliation=await rpc<{revision:string}>('get_finance_reconciliation_context',[i.tenant,[movement.movement_id],statement.entryIds]);
 await rpc('reconcile_finance_bank_group',[{...base(),movement_ids:[movement.movement_id],bank_entry_ids:statement.entryIds,expected_revision:reconciliation.revision,account_evidence:'Conta e titular conferidos no extrato'}]);
 for(const [writer,reader,extra] of [
  ['record_finance_account_opening','get_finance_statement_period_evidence',{}],
  ['record_finance_statement_coverage_approval','get_finance_statement_coverage_review',{originals_obtained_from_bank:true,complete_period_confirmed:true}],
  ['review_finance_legacy_cut','get_finance_legacy_cut_review',{sources_reviewed:true}],
 ] as const){const context=await rpc<{revision:string}>(reader,[i.tenant,i.account,scope.from,scope.to]);await rpc(writer,[{...base(),...scope,revision:context.revision,...extra}]);}
 const preview=await rpc<{revision:string}>('preview_finance_account_period_close',[i.tenant,i.account,scope.from,scope.to]);
 const closed=await rpc<{closure_id:string;revision:string}>('close_finance_account_period',[{...base(),...scope,revision:preview.revision}]);
 const read=async()=>periodUnloadingFlowSchema.parse(await rpc('get_finance_period_unloading_flow',[i.tenant,scope.from,scope.to,[i.account],null,1,null]));
 const money=periodMoneyPackageSchema.parse(await rpc('get_finance_period_money_package',[i.tenant,scope.from,scope.to,[i.account]]));
 const flow=await read();expect(flow.money_package_revision).toBe(money.revision);expect(money.totals.in_cents).toBe('30000');
 expect(flow.origin_totals).toMatchObject({valid:true,amount_cents:'15000'});expect(flow.receipt_totals).toMatchObject({valid:true,amount_cents:'10000'});
 expect(flow.money_links).toHaveLength(1);expect(flow.money_links[0]).toMatchObject({movement_id:movement.movement_id,amount_cents:'30000',allocated_event_cents:'10000',money_covered:true,closure_ids:[closed.closure_id]});
 expect(flow.rows.find(row=>row.kind==='receipt')).toMatchObject({money_covered:true,closure_ids:[closed.closure_id]});
 await rpc('reopen_finance_account_period',[{...base(),closure_id:closed.closure_id,revision:closed.revision}]);
 const reopened=await read();expect(reopened.revision).not.toBe(flow.revision);expect(reopened.receipt_totals).toMatchObject({valid:true,amount_cents:'10000'});expect(reopened.money_links[0].money_covered).toBe(false);
},30000);
