// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {createFinanceLedgerDatabase,financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:PGlite;
beforeAll(async()=>{
 db=await createFinanceLedgerDatabase();
 await db.exec(`alter table bank_accounts add column bank_code text default '001',add column branch_number text default '1234',add column account_number text default '123-4',add column account_type text default 'checking';
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
 alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;
 create function finance_private.can_read_receipt(text) returns boolean language sql as $$select true$$;`);
 for(const name of ['20260909222851_finance_statement_intake','20260909223737_finance_statement_source_verification','20260909233625_finance_audit_queries','20260910020543_finance_ofx_statement_intake','20260910021404_finance_native_statement_account','20260910130956_finance_statement_period_evidence','20260910140010_finance_account_opening_balances'])await db.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'));
},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db.close();});
const date=(day:string,time:string)=>({date:day,raw:day.replace(/-/g,'')+time+'[-3:BRT]',offset_minutes:-180});
async function source(day:string,cents:number,start='2026-09-01',end='2026-09-30',time='235959'){
 const id=randomUUID(),verification=randomUUID(),hash=id.replace(/-/g,'').repeat(2);
 await db.query(`insert into finance_statement_imports(id,tenant_id,bank_account_id,file_hash,source_path,file_name,source_snapshot,parser_version,mapping,period_start,period_end,currency,input_rows,created_by)
 values($1,$2,$3,$4,'path','extrato.ofx','{}','native-ofx-v1','{}',$5,$6,'BRL',0,$7)`,[id,i.tenant,i.account,hash,start,end,i.operator]);
 const report={hash_verified:true,actual_hash:hash,identity_trust:'native_file_identifier',native_evidence:{parser_version:'native-ofx-v1',currency:'BRL',account:{bank_id:'001',branch_id:'1234',account_id:'123-4',account_type:'CHECKING'},outside_declared_period:false,repeated_bank_ids:[],period:{start:date(start,'000000'),end:date(end,'235959')},ledger_balance:{amount_cents:cents,as_of:date(day,time)}}};
 await db.query(`insert into finance_statement_verifications(id,tenant_id,import_id,actor_id,reader_version,source_revision,outcome,report) values($1,$2,$3,$4,'statement-source-v1','revision','rows_match',$5)`,[verification,i.tenant,id,i.operator,report]);
 return {id,verification,report};
}
async function read(actor=i.operator){return (await financeAs<{result:Record<string,unknown>}>(db,actor,'select get_finance_statement_period_evidence($1,$2,$3,$4) result',[i.tenant,i.account,'2026-09-01','2026-09-30'])).rows[0].result;}
async function payload(){return {version:1,tenant_id:i.tenant,request_id:randomUUID(),account_id:i.account,from:'2026-09-01',to:'2026-09-30',revision:(await read()).revision,reason:'Conferência da abertura com extrato original'};}
async function record(p:unknown,actor=i.operator){return (await financeAs<{result:{opening_id:string}}>(db,actor,'select record_finance_account_opening($1) result',[p])).rows[0].result;}
async function opening(from='2026-09-01',to='2026-09-30',actor=i.operator){return (await financeAs<{result:Record<string,unknown>}>(db,actor,'select get_finance_account_opening($1,$2,$3,$4) result',[i.tenant,i.account,from,to])).rows[0].result;}
it('derives cents from the identified anchor without generating a revenue or money movement',async()=>{
 const s=await source('2026-08-31',12345);const p=await payload();const result=await record(p);
 expect(result).toMatchObject({confirmed:true,cash_created:false});
 expect(await opening()).toMatchObject({opening:{balance_cents:'12345',actor_id:i.operator,evidence_status:'valid'},book:{opening_cents:'12345',in_cents:'0',out_cents:'0',closing_cents:'12345'},can_close:false});
 expect((await db.query('select * from finance_movements')).rows).toEqual([]);
 const saved=(await db.query<{evidence:{opening_anchors:unknown[]}}>('select evidence from finance_account_openings')).rows[0];
 expect(saved.evidence.opening_anchors).toEqual([expect.objectContaining({import_id:s.id,verification_id:s.verification,cents:'12345'})]);
 await expect(record({...p,request_id:randomUUID(),balance_cents:99999})).rejects.toThrow('finance_invalid_payload');
});
it('replays the same command even after evidence changes and rejects conflicting payload reuse',async()=>{
 await source('2026-08-31',10000);const p=await payload(),first=await record(p);await source('2026-08-31',11000);
 expect(await record(p)).toEqual(first);
 await expect(record({...p,reason:'Outra justificativa para mesma chave'})).rejects.toThrow('finance_request_conflict');
 expect((await db.query('select * from finance_account_openings')).rows).toHaveLength(1);
 expect((await db.query('select * from finance_events')).rows).toHaveLength(1);
});
it('rejects a stale evidence revision without leaving a command or opening',async()=>{
 await source('2026-08-31',10000);const p=await payload();await source('2026-09-30',10000);
 await expect(record(p)).rejects.toThrow('finance_opening_evidence_changed');
 expect((await db.query('select * from finance_commands')).rows).toEqual([]);
 expect((await db.query('select * from finance_account_openings')).rows).toEqual([]);
});
it('permits only one active opening per account',async()=>{
 await source('2026-08-31',10000);await record(await payload());
 await expect(record(await payload())).rejects.toThrow('finance_account_opening_exists');
 expect((await db.query('select * from finance_account_openings')).rows).toHaveLength(1);
});
it('reverses with permanent authorship, replay and immutable history before a replacement',async()=>{
 await source('2026-08-31',10000);const original=await record(await payload());
 const p={version:1,tenant_id:i.tenant,request_id:randomUUID(),opening_id:original.opening_id,reason:'Reverter abertura para nova conferência'};
 const reverse=(p:unknown)=>financeAs(db,i.operator,'select reverse_finance_account_opening($1) result',[p]);
 const first=await reverse(p);expect(await reverse(p)).toEqual(first);
 await expect(reverse({...p,request_id:randomUUID()})).rejects.toThrow('finance_opening_already_reversed');
 expect(await opening()).toMatchObject({opening:null,book:null,history:[{id:original.opening_id,actor_id:i.operator,reversal:{actor_id:i.operator,reason:p.reason}}]});
 await record(await payload());expect((await opening()).history).toHaveLength(2);
 for(const table of ['finance_account_openings','finance_account_opening_reversals']){
  await db.exec('savepoint immutable');await expect(db.exec(`delete from ${table}`)).rejects.toThrow('finance_immutable_record');await db.exec('rollback to savepoint immutable');
 }
 const audit=(await financeAs<{result:{rows:{manual_intervention:boolean}[]}}>(db,i.operator,'select list_finance_audit_events($1,$2) result',[i.tenant,{manual_only:true}])).rows[0].result;
 expect(audit.rows).toHaveLength(3);expect(audit.rows.every(row=>row.manual_intervention)).toBe(true);
 expect((await db.query('select * from finance_movements')).rows).toEqual([]);
});
it('requires review after an anchor verification changes, even with the same balance',async()=>{
 const s=await source('2026-08-31',10000);await record(await payload());
 await db.query(`insert into finance_statement_verifications(tenant_id,import_id,actor_id,reader_version,source_revision,outcome,report,created_at) values($1,$2,$3,'statement-source-v1','new-verification','rows_match',$4,clock_timestamp()+interval '1 second')`,[i.tenant,s.id,i.operator,s.report]);
 expect(await opening()).toMatchObject({opening:{balance_cents:'10000',evidence_status:'requires_review'},can_close:false});
});
it('requires review when the saved anchor becomes contradictory',async()=>{
 await source('2026-08-31',10000);await record(await payload());await source('2026-08-31',9000);
 expect(await opening()).toMatchObject({opening:{balance_cents:'10000',evidence_status:'requires_review'},can_close:false});
});
it('denies driver and mixed profiles for reads, records and reversals',async()=>{
 await source('2026-08-31',10000);const p=await payload(),saved=await record(p);
 for(const mixed of [false,true]){
  if(mixed)await db.query("insert into tenant_memberships values($1,$2,'operator',true)",[i.tenant,i.driverUser]);
  await expect(record({...p,request_id:randomUUID()},i.driverUser)).rejects.toThrow('finance_access_denied');
  await expect(opening(undefined,undefined,i.driverUser)).rejects.toThrow('finance_access_denied');
  await expect(financeAs(db,i.driverUser,'select reverse_finance_account_opening($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),opening_id:saved.opening_id,reason:'Reversão não autorizada'}])).rejects.toThrow('finance_access_denied');
  expect((await financeAs(db,i.driverUser,'select * from finance_account_openings')).rows).toEqual([]);
 }
});
it('rejects foreign tenant and foreign account commands',async()=>{
 const p=await payload();await expect(record({...p,tenant_id:i.otherTenant,account_id:i.otherAccount})).rejects.toThrow('finance_access_denied');
 await expect(record({...p,account_id:i.otherAccount})).rejects.toThrow('finance_account_not_found');
});
it('rejects cash accounts and missing opening anchors',async()=>{
 await expect(record(await payload())).rejects.toThrow('finance_opening_anchor_required');
 await source('2026-08-31',10000);const p=await payload();await db.query("update bank_accounts set account_type='cash' where id=$1",[i.account]);
 await expect(record(p)).rejects.toThrow('finance_cash_opening_requires_count');
});
it('carries prior movements into a subperiod and excludes movements outside its cutoff',async()=>{
 await source('2026-08-31',10000);await record(await payload());
 for(const [day,direction,cents] of [['2026-08-31','in',90000],['2026-09-01','in',2000],['2026-09-02','out',500],['2026-09-10','in',300],['2026-09-15','out',700],['2026-09-21','out',4000]] as const){
  await db.query(`insert into finance_movements(tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,created_by) values($1,$2,$3,'other',$4,$5,'Movimento real','QA',$6)`,[i.tenant,i.account,direction,cents,day,i.operator]);
 }
 expect(await opening('2026-09-10','2026-09-20')).toMatchObject({book:{opening_cents:'11500',in_cents:'300',out_cents:'700',closing_cents:'11100'},can_close:false});
 expect(await opening('2026-08-30','2026-09-20')).toMatchObject({book:null});
});
it('rejects contradictory opening balances without choosing one arbitrarily',async()=>{
 await source('2026-08-31',10000);await source('2026-08-31',11000);
 await expect(record(await payload())).rejects.toThrow('finance_opening_anchor_required');
 expect((await db.query('select * from finance_account_openings')).rows).toEqual([]);
});
it('rejects a day-only opening anchor and an explicit non-Brazilian cutoff',async()=>{
 await source('2026-08-31',10000,'2026-08-01','2026-08-31','');
 await expect(record(await payload())).rejects.toThrow('finance_opening_anchor_required');
 const s=await source('2026-08-31',10000);
 const report={...s.report,native_evidence:{...s.report.native_evidence,ledger_balance:{amount_cents:10000,as_of:{date:'2026-08-31',raw:'20260831235959[0:UTC]',offset_minutes:0}}}};
 await db.query(`insert into finance_statement_verifications(tenant_id,import_id,actor_id,reader_version,source_revision,outcome,report,created_at) values($1,$2,$3,'statement-source-v1','utc','rows_match',$4,clock_timestamp()+interval '1 second')`,[i.tenant,s.id,i.operator,report]);
 await expect(record(await payload())).rejects.toThrow('finance_opening_anchor_required');
});
it('preserves a negative bank balance and denies authenticated direct writes',async()=>{
 await source('2026-08-31',-12345);await record(await payload());
 expect(await opening()).toMatchObject({book:{opening_cents:'-12345',closing_cents:'-12345'}});
 await expect(financeAs(db,i.operator,'delete from finance_account_openings')).rejects.toThrow('permission denied');
 await expect(financeAs(db,i.operator,'insert into finance_account_opening_reversals default values')).rejects.toThrow('permission denied');
});
