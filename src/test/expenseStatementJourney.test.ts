// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {createExpenseStatementJourneyDatabase} from './helpers/expenseStatementJourneyDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {ofxFile,ofxTransaction} from './helpers/financeOfxFixture';
import {readOfxStatement} from '../../supabase/functions/_shared/finance-ofx-reader';
import {verifyStatementSource,type StatementSourceContext} from '../../supabase/functions/finance-statement-verify/worker';
import {expenseHistorySchema} from '@/lib/financial/expenseHistoryContract';
import {reconciliationContextSchema} from '@/lib/financial/reconciliationContract';
let db:Awaited<ReturnType<typeof createExpenseStatementJourneyDatabase>>;
const account='cf600000-0000-4000-8000-000000000001';
beforeAll(async()=>{db=await createExpenseStatementJourneyDatabase();},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});

const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Conferência completa de gasto e extrato'});
async function rpc<T>(name:string,args:unknown[]){return(await operationRpc<{v:T}>(db,`select ${name}(${args.map((_,n)=>'$'+(n+1)).join(',')}) v`,args)).rows[0].v;}
async function prepare(custodyClosed=true){
 await db.query("insert into bank_accounts(id,tenant_id,name,bank_code,branch_number,account_number,account_type,active) values($1,$2,'Conta operacional','001','1234','000123-4','checking',true)",[account,i.tenant]);
 const driver=(await db.query<{id:string}>('select id from drivers where tenant_id=$1 limit 1',[i.tenant])).rows[0].id,trip=randomUUID();
 await db.query("update drivers set name='Motorista da jornada' where id=$1",[driver]);
 await db.query("insert into dispatch_trips(id,tenant_id,driver_id,status) values($1,$2,$3,'completed')",[trip,i.tenant,driver]);
 const vehicle=(await db.query<{id:string}>('select id from vehicles where tenant_id=$1 limit 1',[i.tenant])).rows[0].id;
 await db.query("insert into trip_cargo_controls(tenant_id,dispatch_trip_id,driver_id,vehicle_id,status,closed_at,closed_by) values($1,$2,$3,$4,$5,$6,$7)",[i.tenant,trip,driver,vehicle,custodyClosed?'closed':'returned',custodyClosed?'2026-09-08T20:00:00Z':null,custodyClosed?i.operator:null]);
 const movement=await rpc<{movement_id:string}>('record_finance_movement',[{...base(),bank_account_id:account,direction:'out',nature:'driver_advance',amount_cents:50000,driver_id:driver,occurred_on:'2026-09-09',description:'Envio registrado para viagem',beneficiary_name:'Motorista conferido'}]);
 return{trip,driver,movement:movement.movement_id};
}
async function batch(trip:string,movement:string,total=48000){
 const items=[];for(const [category,amount,allocated] of [['fuel',30000,30000],['food',total-30000,Math.min(total-30000,20000)]] as const){
  const receipt=i.tenant+'/finance-batches/'+randomUUID()+'.pdf';await db.query("insert into storage.objects(bucket_id,name,metadata) values('receipts',$1,'{\"mimetype\":\"application/pdf\",\"size\":100}')",[receipt]);
  items.push({id:randomUUID(),category,description:'Gasto conferido '+category,amount_cents:amount,occurred_on:'2026-09-09',supplier_name:'Estabelecimento do recibo',payee_type:'driver',receipt_path:receipt,allocations:[{movement_id:movement,amount_cents:allocated}]});
 }
 const payload={...base(),context:'trip',trip_id:trip,description:'Prestação de contas da viagem',items};const first=await rpc('record_finance_expense_batch',[payload]);expect(await rpc('record_finance_expense_batch',[payload])).toEqual(first);return first;
}
async function statement(){
 const bytes=new TextEncoder().encode(ofxFile(ofxTransaction('outgoing-500','-500.00'))),hash=createHash('sha256').update(bytes).digest('hex'),path=i.tenant+'/imports/'+hash+'.ofx';
 await db.query("insert into storage.objects(bucket_id,name,metadata) values('finance-statements',$1,$2)",[path,{size:bytes.length,mimetype:'application/x-ofx'}]);
 const command={...base(),bank_account_id:account,file_hash:hash,source_path:path,file_name:'extrato-original.ofx',currency:'BRL',parser_version:'native-ofx-v1',mapping:{},period_start:'2026-09-01',period_end:'2026-09-30',rows:readOfxStatement(bytes).rows};
 const result=await rpc<{import_id:string}>('intake_finance_statement',[command]);
 await verifyStatementSource({tenant:i.tenant,actor:i.operator,importId:result.import_id,request:randomUUID()},{
  inspect:()=>rpc<StatementSourceContext>('inspect_finance_statement_source',[i.tenant,result.import_id]),
  download:async requested=>{if(requested!==path)throw new Error('Wrong original path');return bytes;},
  workbook:async()=>{throw new Error('OFX must use real native reader');},
  authorize:async()=>(await db.query<{ok:boolean}>('select finance_private.can_access($1) ok',[i.tenant])).rows[0].ok,
  record:async payload=>{await db.exec('savepoint verification;set role service_role');try{const value=await db.query('select record_finance_statement_verification($1)',[payload]);await db.exec('reset role;release savepoint verification');return value;}catch(e){await db.exec('rollback to savepoint verification;release savepoint verification');throw e;}},
 });
 const proof=(await db.query<{outcome:string;report:{hash_verified:boolean}}>('select outcome,report from finance_statement_verifications where import_id=$1',[result.import_id])).rows[0];expect(proof).toMatchObject({outcome:'rows_match',report:{hash_verified:true}});
 const entry=(await db.query<{id:string}>('select id from finance_bank_entries where first_import_id=$1',[result.import_id])).rows[0].id;return{...result,entry};
}
it('records 500, allocates costs 480, preserves 20, verifies original OFX and reconciles once',async()=>{
 const origin=await prepare();await batch(origin.trip,origin.movement);const history=expenseHistorySchema.parse(await rpc('list_finance_expenses',[i.tenant,{}]));expect(history).toMatchObject({total:2,total_cents:'48000',allocated_cents:'48000',complement_cents:'0'});
 const remaining=await rpc<{rows:{id:string;remaining_cents:number}[]}>('get_finance_expense_options',[i.tenant,'movements','',origin.trip,1]);expect(remaining.rows.find(row=>row.id===origin.movement)?.remaining_cents).toBe(2000);
 const source=await statement();const context=reconciliationContextSchema.parse(await rpc('get_finance_reconciliation_context',[i.tenant,[origin.movement],[source.entry]]));
 const command={...base(),movement_ids:[origin.movement],bank_entry_ids:[source.entry],expected_revision:context.revision,account_evidence:'Conta, data e valor conferidos no original'};
 const match=await rpc('reconcile_finance_bank_group',[command]);expect(await rpc('reconcile_finance_bank_group',[command])).toEqual(match);
 expect((await db.query<{n:number}>('select count(*)::int n from finance_reconciliation_groups')).rows[0].n).toBe(1);
 expect((await db.query<{n:number;amount:string}>('select count(*)::int n,sum(amount_cents)::text amount from finance_movements')).rows[0]).toEqual({n:1,amount:'50000'});
 expect((await db.query<{amount:string}>('select sum(amount_cents)::text amount from finance_bank_entries')).rows[0].amount).toBe('-50000');
 expect((await db.query<{n:number}>('select count(*)::int n from payables')).rows[0].n).toBe(0);
 expect((await db.query<{amount:string}>('select sum(amount_cents)::text amount from finance_expense_allocations')).rows[0].amount).toBe('48000');
});
it('keeps one 500 outgoing and creates only a 30 driver complement for costs 530',async()=>{
 const origin=await prepare();await batch(origin.trip,origin.movement,53000);const history=expenseHistorySchema.parse(await rpc('list_finance_expenses',[i.tenant,{}]));expect(history).toMatchObject({total:2,total_cents:'53000',allocated_cents:'50000',complement_cents:'3000'});
 const payable=(await db.query<{amount:string;driver_id:string}>('select amount,driver_id from payables')).rows;expect(payable).toHaveLength(1);expect(Number(payable[0].amount)).toBe(30);expect(payable[0].driver_id).toBe(origin.driver);expect((await db.query<{n:number}>('select count(*)::int n from finance_movements')).rows[0].n).toBe(1);
});
it('does not release a merely completed trip while cargo custody remains open',async()=>{
 const origin=await prepare(false);await expect(rpc('get_finance_expense_options',[i.tenant,'movements','',origin.trip,1])).rejects.toThrow('trip_cargo_not_closed');
 await expect(batch(origin.trip,origin.movement)).rejects.toThrow('trip_cargo_not_closed');
 expect((await db.query<{n:number}>('select count(*)::int n from finance_expense_items')).rows[0].n).toBe(0);
 expect((await db.query<{n:number}>('select count(*)::int n from finance_movements')).rows[0].n).toBe(1);
});
it('keeps an invalidated outgoing in history but neither offers it nor accepts a new expense allocation',async()=>{
 const origin=await prepare();const before=(await db.query<{v:Record<string,unknown>}>('select to_jsonb(m) v from finance_movements m where id=$1',[origin.movement])).rows[0].v;
 const originalRequest=(await db.query<{request_id:string}>("select request_id from finance_commands where tenant_id=$1 and action='record_movement' and result->>'movement_id'=$2",[i.tenant,origin.movement])).rows[0].request_id;
 // Fixture of an already invalidated representation: real original RPC,
 // FK-backed void and original audit are retained. This does not claim to run
 // the separate public void command or bypass its release/readiness checks.
 const request=randomUUID();await db.query("insert into finance_commands(tenant_id,request_id,actor_id,action,payload,result) values($1,$2,$3,'qa_existing_void','{}','{}')",[i.tenant,request,i.operator]);
 await db.query("insert into finance_movement_voids(tenant_id,movement_id,original_request_id,request_id,kind,actor_id,actor_name,reason,revision,source_snapshot) values($1,$2,$3,$4,'void',$5,'QA','Representação invalidada preservada para regressão',md5($6::jsonb::text),$6)",[i.tenant,origin.movement,originalRequest,request,i.operator,{movement:before}]);
 await expect(batch(origin.trip,origin.movement)).rejects.toThrow('finance_movement_voided');
 expect((await db.query<{n:number}>('select count(*)::int n from finance_expense_items')).rows[0].n).toBe(0);expect((await db.query<{n:number}>('select count(*)::int n from finance_expense_batches')).rows[0].n).toBe(0);
 expect((await db.query<{v:Record<string,unknown>}>('select to_jsonb(m) v from finance_movements m where id=$1',[origin.movement])).rows[0].v).toEqual(before);
 expect((await db.query<{n:number}>('select count(*)::int n from finance_movement_voids where movement_id=$1',[origin.movement])).rows[0].n).toBe(1);
 expect((await db.query<{n:number}>("select count(*)::int n from finance_events where entity_id=$1 and action='recorded'",[origin.movement])).rows[0].n).toBe(1);
 const options=()=>rpc<{rows:{id:string}[]}>('get_finance_expense_options',[i.tenant,'movements','',origin.trip,1]);expect((await options()).rows.map(row=>row.id)).not.toContain(origin.movement);
 // Reinstall the actual pre-fix reader to reproduce the production regression,
 // then apply the additive fix twice. Neither step edits the historic SQL file.
 const gate=readFileSync('supabase/migrations/20260910211800_canonical_trip_cargo_close_gate.sql','utf8'),start=gate.indexOf('create or replace function finance_private.expense_options('),end=gate.indexOf('$function$;',start);await db.exec(gate.slice(start,end+'$function$;'.length));
 expect((await options()).rows.map(row=>row.id)).toContain(origin.movement);
 const fix=readFileSync('supabase/migrations/20260910220847_finance_cargo_expense_active_movements.sql','utf8');await db.exec(fix);
 const definition=async()=>(await db.query<{body:string}>("select pg_get_functiondef('finance_private.expense_options(uuid,text,text,uuid,integer)'::regprocedure) body")).rows[0].body;
 const first=await definition();await db.exec(fix);expect(await definition()).toBe(first);expect((await options()).rows.map(row=>row.id)).not.toContain(origin.movement);
});
it('refuses the reader correction when the custody contract has drifted',async()=>{
 const fix=readFileSync('supabase/migrations/20260910220847_finance_cargo_expense_active_movements.sql','utf8');const body=(await db.query<{body:string}>("select pg_get_functiondef('finance_private.expense_options(uuid,text,text,uuid,integer)'::regprocedure) body")).rows[0].body;
 await db.exec('savepoint drift');await db.exec(body.split('private.trip_cargo_is_closed_v1').join('private.unreviewed_cargo_predicate'));
 await expect(db.exec(fix)).rejects.toThrow('finance_cargo_expense_options_contract_changed');await db.exec('rollback to savepoint drift;release savepoint drift');
 expect((await db.query<{body:string}>("select pg_get_functiondef('finance_private.expense_options(uuid,text,text,uuid,integer)'::regprocedure) body")).rows[0].body).toBe(body);
});
