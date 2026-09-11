// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {createReceivableTemporalDatabase,receivableTemporalMigration} from './helpers/receivableTemporalDatabase';
import {operationIds as i} from './helpers/operationOutcomeDatabase';
import {createFinancialScenario,financialCommand,financialPayload,reversalPayload} from './helpers/receivableFinancialDatabase';
let db:PGlite;const existing=randomUUID();
beforeAll(async()=>{
 db=await createReceivableTemporalDatabase(false);
 await db.query("insert into receivables(id,tenant_id,amount,status,due_date,created_by) values($1,$2,100,'pending','2026-01-31',$3)",[existing,i.tenant,i.operator]);
 await db.exec(readFileSync('supabase/migrations/'+receivableTemporalMigration,'utf8'));
},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function events(id:string){return(await db.query<{operation:string;old_data:Record<string,unknown>|null;new_data:Record<string,unknown>|null;actor_id:string|null;actor_name:string|null;actor_kind:string;event_order:number;transaction_id:number}>('select * from finance_private.receivable_temporal_versions where receivable_id=$1 order by event_order',[id])).rows;}
it('baselines all existing titles without certifying their past or creating money',async()=>{
 expect(await events(existing)).toMatchObject([{operation:'BASELINE',old_data:null,new_data:{amount:100,due_date:'2026-01-31'}}]);
 const coverage=(await db.query<{capture_basis:string;baseline_kind:string}>("select * from finance_private.receivable_temporal_coverage where tenant_id=$1",[i.tenant])).rows[0];
 expect(coverage).toMatchObject({capture_basis:'transaction_capture_not_commit',baseline_kind:'existing_tenant'});
 expect((await db.query<{n:number}>('select count(*)::int n from finance_movements')).rows[0].n).toBe(0);
});
it('captures renegotiation and deletion in order with full before/after and stable actor label',async()=>{
 await db.query("update receivables set amount=125,due_date='2026-02-28',notes='negociação' where id=$1",[existing]);
 await db.query("update auth.users set raw_user_meta_data='{}',email='renamed@example.test' where id=$1",[i.operator]);
 await db.query('delete from receivables where id=$1',[existing]);
 const rows=await events(existing);expect(rows.map(r=>r.operation)).toEqual(['BASELINE','UPDATE','DELETE']);
 expect(rows[1]).toMatchObject({actor_id:i.operator,actor_name:'Financeiro QA',old_data:{amount:100,due_date:'2026-01-31'},new_data:{amount:125,due_date:'2026-02-28',notes:'negociação'}});
 expect(rows[2]).toMatchObject({old_data:{amount:125},new_data:null,actor_name:'renamed@example.test'});
 expect(rows[1].transaction_id).toBe(rows[2].transaction_id);
});
it('creates coverage for new tenants and records system writers without attributing created_by',async()=>{
 const tenant=randomUUID(),title=randomUUID();await db.query("select set_config('request.jwt.claim.sub','',false)");
 await db.query("insert into tenants(id) values($1)",[tenant]);
 expect((await db.query('select id from tenants where id=$1',[tenant])).rows).toHaveLength(1);
 await db.query("insert into receivables(id,tenant_id,amount,status,created_by) values($1,$2,10,'pending',$3)",[title,tenant,i.operator]);
 expect(await events(title)).toMatchObject([{operation:'INSERT',actor_id:null,actor_name:null,actor_kind:'system',new_data:{created_by:i.operator}}]);
 expect((await db.query<{baseline_kind:string}>('select baseline_kind from finance_private.receivable_temporal_coverage where tenant_id=$1',[tenant])).rows[0].baseline_kind).toBe('new_tenant');
});
it('preserves the original coverage on tenant INSERT ON CONFLICT retries',async()=>{
 const before=(await db.query('select * from finance_private.receivable_temporal_coverage where tenant_id=$1',[i.tenant])).rows;
 await db.query('insert into tenants(id) values($1) on conflict(id) do nothing',[i.tenant]);
 expect((await db.query('select * from finance_private.receivable_temporal_coverage where tenant_id=$1',[i.tenant])).rows).toEqual(before);
});
it('rolls back captured changes atomically and preserves append-only storage',async()=>{
 await db.exec('savepoint attempt');await db.query('update receivables set amount=200 where id=$1',[existing]);await db.exec('rollback to savepoint attempt;release savepoint attempt');
 expect(await events(existing)).toHaveLength(1);
 for(const sql of ['delete from finance_private.receivable_temporal_versions','update finance_private.receivable_temporal_coverage set coverage_starts_at=now()','truncate finance_private.receivable_temporal_versions','truncate receivables cascade']){
  await db.exec('savepoint forbidden');await expect(db.exec(sql)).rejects.toThrow('finance_receivable_temporal_history_immutable');await db.exec('rollback to savepoint forbidden;release savepoint forbidden');
 }
});
it('never exposes full snapshots or trigger functions through API roles',async()=>{
 for(const role of ['anon','authenticated','service_role']){
  const row=(await db.query<{read:boolean;write:boolean;execute:boolean}>("select has_table_privilege($1,'finance_private.receivable_temporal_versions','select') read,has_table_privilege($1,'finance_private.receivable_temporal_versions','insert') write,has_function_privilege($1,'finance_private.capture_receivable_temporal_version()','execute') execute",[role])).rows[0];
  expect(row).toEqual({read:false,write:false,execute:false});
 }
});
it('rejects missing or null source identity even for privileged malformed inserts',async()=>{
 for(const snapshot of [{},{id:existing,tenant_id:null},{id:null,tenant_id:i.tenant},null,[]]){
  await db.exec('savepoint malformed');
  await expect(db.query("insert into finance_private.receivable_temporal_versions(tenant_id,receivable_id,operation,new_data,actor_kind) values($1,$2,'INSERT',$3::jsonb,'system')",[i.tenant,existing,JSON.stringify(snapshot)])).rejects.toThrow('check constraint');
  await db.exec('rollback to savepoint malformed;release savepoint malformed');
 }
});
it('records real financial payment and refund projections without an extra payment',async()=>{
 await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
 const f=await createFinancialScenario(db),m=randomUUID();
 await db.query("insert into finance_movements(id,tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,created_by) values($1,$2,$3,'in','receipt',1000,current_date,'Recebimento','QA',$4)",[m,i.tenant,f.bank,i.operator]);
 const p=await financialCommand(db,await financialPayload(db,f.receivable,{amount_cents:1000,movement_id:m}));
 const before=await events(f.receivable);expect(before.some(r=>r.new_data?.received_amount===10)).toBe(true);
 await financialCommand(db,reversalPayload(await financialPayload(db,f.receivable),p.payment_id!));
 expect((await events(f.receivable)).at(-1)?.new_data?.received_amount).toBe(0);
 expect((await db.query<{n:number}>('select count(*)::int n from receivables_payments where receivable_id=$1',[f.receivable])).rows[0].n).toBe(1);
});
it('captures real fiscal worker creation and cancellation with system attribution',async()=>{
 const payer=randomUUID(),source=randomUUID(),emission=randomUUID();
 await db.query("insert into clients(id,tenant_id,active,company_name) values($1,$2,true,'Fornecedor histórico')",[payer,i.tenant]);
 await db.query('insert into cte_documents(id,tenant_id,client_id,freight_value,net_value) values($1,$2,$3,1000,1000)',[source,i.tenant,payer]);
 await db.query("select set_config('request.jwt.claim.sub','',false)");
 await db.query("insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state,cte_document_id,access_key,authorization_protocol,number) values($1,$2,'cte','production','authorized','recorded',$3,$4,$5,'123')",[emission,i.tenant,source,'1'.repeat(44),'2'.repeat(15)]);
 async function project(){return(await db.query<{result:{receivable_id:string;status:string}}>('select finance_private.process_fiscal_observation($1,(select id from finance_fiscal_observations where emission_id=$2 order by observed_order desc limit 1)) result',[i.tenant,emission])).rows[0].result;}
 const first=await project();expect(first.status).toBe('applied');
 expect(await events(first.receivable_id)).toMatchObject([{operation:'INSERT',actor_kind:'system',actor_id:null,new_data:{amount:1000,client_id:payer}}]);
 await db.query("update hub_fiscal_emissions set status='cancelled' where id=$1",[emission]);await project();
 expect((await events(first.receivable_id)).at(-1)).toMatchObject({operation:'UPDATE',actor_kind:'system',new_data:{status:'cancelled'}});
 expect((await db.query<{new_payer_snapshot:unknown}>('select new_payer_snapshot from finance_private.receivable_temporal_versions where receivable_id=$1 order by event_order limit 1',[first.receivable_id])).rows[0].new_payer_snapshot).toEqual({id:payer,tenant_id:i.tenant,company_name:'Fornecedor histórico'});
});
it('has tenant-isolated finance RLS even if a future reader grant is added, excluding mixed drivers',async()=>{
 // Temporary test-only grant exercises defense-in-depth; production remains ungranted.
 await db.exec('grant select on finance_private.receivable_temporal_versions to authenticated;set role authenticated');
 expect((await db.query('select * from finance_private.receivable_temporal_versions where receivable_id=$1',[existing])).rows).toHaveLength(1);
 await db.exec('reset role');
 await db.query('insert into drivers(id,tenant_id,user_id,active) values(gen_random_uuid(),$1,$2,true)',[i.tenant,i.operator]);
 await db.exec('set role authenticated');expect((await db.query('select * from finance_private.receivable_temporal_versions')).rows).toHaveLength(0);await db.exec('reset role');
});
it('rejects identity changes and captures tenant bootstrap before any AFTER seed',async()=>{
 await db.exec('savepoint bad_identity');await expect(db.query('update receivables set tenant_id=$1 where id=$2',[i.otherTenant,existing])).rejects.toThrow();await db.exec('rollback to savepoint bad_identity;release savepoint bad_identity');
 await db.exec("create function public.qa_seed_title() returns trigger language plpgsql as $$begin insert into public.receivables(tenant_id,amount,status) values(new.id,1,'pending');return new;end$$;create trigger aa_seed_title after insert on public.tenants for each row execute function public.qa_seed_title()");
 const tenant=randomUUID();await db.query('insert into tenants(id) values($1)',[tenant]);
 expect((await db.query<{operation:string}>('select operation from finance_private.receivable_temporal_versions where tenant_id=$1',[tenant])).rows).toEqual([{operation:'INSERT'}]);
});
it('captures the real unloading command once under the original supplier and due date',async()=>{
 await db.exec('alter table fiscal_documents add column if not exists supplier_id uuid');
 await db.exec(readFileSync('supabase/migrations/20260909212514_finance_delivery_unloading.sql','utf8'));
 const row=(await db.query<{id:string;client_id:string}>(`select s.id,s.client_id from dispatch_stops s where s.tenant_id=$1
  and s.client_id is not null and exists(select 1 from dispatch_stop_documents d where d.dispatch_stop_id=s.id and d.tenant_id=s.tenant_id) order by s.id limit 1`,[i.tenant])).rows[0];
 expect(row).toBeDefined();
 await db.query("update clients set company_name='Fornecedor descarga' where id=$1 and tenant_id=$2",[row.client_id,i.tenant]);
 await db.query('update fiscal_documents set supplier_id=$1 where tenant_id=$2 and id in(select fiscal_document_id from dispatch_stop_documents where dispatch_stop_id=$3)',[row.client_id,i.tenant,row.id]);
 const context=(await db.query<{result:{revision:string;issue:string|null}}>('select get_finance_delivery_context($1,$2) result',[i.tenant,row.id])).rows[0].result;
 expect(context.issue).toBeNull();
 const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),stop_id:row.id,expected_revision:context.revision,amount_cents:15000,occurred_on:'2026-01-01',due_date:'2026-02-01',receipt_path:i.tenant+'/receipts/unloading.pdf',reason:'Descarga com fonte conferida'};
 const result=(await db.query<{result:{receivable_id:string}}>('select record_finance_unloading($1) result',[payload])).rows[0].result;
 expect(await events(result.receivable_id)).toMatchObject([{operation:'INSERT',new_data:{amount:150,client_id:row.client_id,due_date:'2026-02-01'}}]);
 await db.query('select record_finance_unloading($1)',[payload]);expect(await events(result.receivable_id)).toHaveLength(1);
});
