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
 for(const name of ['20260909222851_finance_statement_intake','20260909223737_finance_statement_source_verification','20260909233625_finance_audit_queries','20260910020543_finance_ofx_statement_intake','20260910021404_finance_native_statement_account','20260910130956_finance_statement_period_evidence'])await db.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'));
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
it('reports missing evidence instead of manufacturing zero opening/closing balances',async()=>{
 const r=await read();expect(r).toMatchObject({opening_balance_cents:null,closing_balance_cents:null,missing_declared_days:30,arithmetic_status:'missing_anchors',can_close:false});
});
it('compares two independent native ledger anchors but never closes on equal balances',async()=>{
 await source('2026-08-31',10000,'2026-08-01','2026-08-31');await source('2026-09-30',10000);
 expect(await read()).toMatchObject({opening_balance_cents:'10000',closing_balance_cents:'10000',difference_cents:'0',arithmetic_status:'equal',missing_declared_days:0,declaration_status:'declared_full_days',coverage_status:'requires_review',authenticity_status:'not_attested',can_close:false});
});
it('retains gaps even when endpoints and arithmetic agree',async()=>{
 await source('2026-08-31',10000,'2026-09-01','2026-09-10');await source('2026-09-30',10000,'2026-09-12','2026-09-30');
 expect(await read()).toMatchObject({missing_declared_days:1,arithmetic_status:'equal',declaration_status:'gaps',can_close:false});
});
it('uses signed identified transactions once in the balance equation',async()=>{
 await source('2026-08-31',10000);const s=await source('2026-09-30',9500);
 for(const [index,cents] of [2000,-2500].entries())await db.query(`insert into finance_bank_entries(tenant_id,bank_account_id,first_import_id,source_row,posted_on,amount_cents,currency,description,raw)
 values($1,$2,$3,$4,'2026-09-15',$5,'BRL','Movimento','{}')`,[i.tenant,i.account,s.id,index+1,cents]);
 expect(await read()).toMatchObject({bank_net_cents:'-500',difference_cents:'0',arithmetic_status:'equal',can_close:false});
});
it('excludes wrong-account native evidence rather than confirming its balance',async()=>{
 await source('2026-08-31',10000);await source('2026-09-30',10000);
 await db.query("update bank_accounts set branch_number='9999' where id=$1",[i.account]);
 expect(await read()).toMatchObject({native_source_count:2,qualified_source_count:0,opening_balance_cents:null,closing_balance_cents:null,missing_declared_days:30});
});
it('does not interpret a date-only or intraday ledger balance as an end-of-day anchor',async()=>{
 await source('2026-08-31',10000,'2026-08-01','2026-08-31','');await source('2026-09-30',10000,'2026-09-01','2026-09-30','120000');
 expect(await read()).toMatchObject({opening_balance_cents:null,closing_balance_cents:null,arithmetic_status:'missing_anchors'});
});
it('keeps incompatible balance timezones explicit',async()=>{
 await source('2026-08-31',10000);const s=await source('2026-09-30',10000);
 const report={...s.report,native_evidence:{...s.report.native_evidence,ledger_balance:{amount_cents:10000,as_of:{date:'2026-09-30',raw:'20260930235959[0:UTC]',offset_minutes:0}}}};
 await db.query(`insert into finance_statement_verifications(tenant_id,import_id,actor_id,reader_version,source_revision,outcome,report,created_at) values($1,$2,$3,'statement-source-v1','updated','rows_match',$4,clock_timestamp()+interval '1 second')`,[i.tenant,s.id,i.operator,report]);
 expect(await read()).toMatchObject({arithmetic_status:'timezone_conflict',difference_cents:null,can_close:false});
});
it('conflicting native anchors and later source failures cannot be silently selected away',async()=>{
 await source('2026-08-31',10000);const s=await source('2026-09-30',10000);await source('2026-09-30',9000);
 expect(await read()).toMatchObject({closing_balance_cents:null,arithmetic_status:'conflicting_anchors'});
 await db.query(`insert into finance_statement_verifications(tenant_id,import_id,actor_id,reader_version,source_revision,outcome,report,created_at) values($1,$2,$3,'statement-source-v1','changed','unreadable','{}',clock_timestamp()+interval '1 second')`,[i.tenant,s.id,i.operator]);
 expect(await read()).toMatchObject({closing_balance_cents:'9000',arithmetic_status:'different',difference_cents:'1000'});
});
it('records immutable authored snapshots, rejects stale revision and replays the exact review',async()=>{
 const r=await read(),p={version:1,tenant_id:i.tenant,request_id:randomUUID(),account_id:i.account,from:'2026-09-01',to:'2026-09-30',revision:r.revision,reason:'Revisão inicial sem evidências suficientes'};
 const call=(p:unknown)=>financeAs<{result:unknown}>(db,i.operator,'select record_finance_period_evidence_review($1) result',[p]);
 const first=await call(p);await source('2026-09-30',10000);expect(await call(p)).toEqual(first);
 await expect(call({...p,request_id:randomUUID()})).rejects.toThrow('finance_period_evidence_changed');
 expect((await db.query('select actor_id,reason from finance_period_evidence_reviews')).rows).toEqual([{actor_id:i.operator,reason:p.reason}]);
 const audit=(await financeAs<{result:{manual_count:number;rows:{action:string;manual_intervention:boolean}[]}}>(db,i.operator,'select list_finance_audit_events($1,$2) result',[i.tenant,{manual_only:true}])).rows[0].result;
 expect(audit.manual_count).toBe(1);expect(audit.rows[0]).toMatchObject({action:'period_evidence_reviewed',manual_intervention:true});
 await db.exec('savepoint immutable');await expect(db.exec('delete from finance_period_evidence_reviews')).rejects.toThrow('finance_immutable_record');await db.exec('rollback to savepoint immutable');
});
it('changes revision when the native coverage source changes even without balance anchors',async()=>{
 const s=await source('2026-09-15',10000),before=await read();
 const verification=randomUUID();await db.query(`insert into finance_statement_verifications(id,tenant_id,import_id,actor_id,reader_version,source_revision,outcome,report,created_at)
 values($1,$2,$3,$4,'statement-source-v1','new-reader-result','rows_match',$5,clock_timestamp()+interval '1 second')`,[verification,i.tenant,s.id,i.operator,s.report]);
 const after=await read();expect(after.anchors).toEqual([]);expect(after.missing_declared_days).toBe(before.missing_declared_days);expect(after.revision).not.toBe(before.revision);
 expect(after.source_evidence).toEqual([expect.objectContaining({import_id:s.id,verification_id:verification,file_hash:expect.any(String)})]);
});
it('denies drivers including mixed profiles and rejects a foreign account',async()=>{
 await expect(read(i.driverUser)).rejects.toThrow('finance_access_denied');
 await db.query("insert into tenant_memberships values($1,$2,'operator',true)",[i.tenant,i.driverUser]);await expect(read(i.driverUser)).rejects.toThrow('finance_access_denied');
 await expect(financeAs(db,i.operator,'select get_finance_statement_period_evidence($1,$2,$3,$4)',[i.tenant,i.otherAccount,'2026-09-01','2026-09-30'])).rejects.toThrow('finance_account_not_found');
});
