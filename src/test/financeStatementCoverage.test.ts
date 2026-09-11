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
 for(const name of ['20260909222851_finance_statement_intake','20260909223737_finance_statement_source_verification','20260909230507_finance_statement_queries','20260909231643_finance_statement_identity_review','20260909233625_finance_audit_queries','20260910020543_finance_ofx_statement_intake','20260910021404_finance_native_statement_account','20260910130956_finance_statement_period_evidence','20260910142143_finance_statement_coverage_approvals'])await db.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'));
},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db.close();});
const date=(day:string,time:string)=>({date:day,raw:day.replace(/-/g,'')+time+'[-3:BRT]',offset_minutes:-180});
async function source(day:string,cents:number,start='2026-08-01',end='2026-08-31',time='235959'){
 const id=randomUUID(),verification=randomUUID(),hash=id.replace(/-/g,'').repeat(2);
 await db.query(`insert into finance_statement_imports(id,tenant_id,bank_account_id,file_hash,source_path,file_name,source_snapshot,parser_version,mapping,period_start,period_end,currency,input_rows,created_by)
 values($1,$2,$3,$4,'path','extrato.ofx','{}','native-ofx-v1','{}',$5,$6,'BRL',0,$7)`,[id,i.tenant,i.account,hash,start,end,i.operator]);
 const report={hash_verified:true,actual_hash:hash,identity_trust:'native_file_identifier',native_evidence:{parser_version:'native-ofx-v1',currency:'BRL',account:{bank_id:'001',branch_id:'1234',account_id:'123-4',account_type:'CHECKING'},outside_declared_period:false,repeated_bank_ids:[],period:{start:date(start,'000000'),end:date(end,'235959')},ledger_balance:{amount_cents:cents,as_of:date(day,time)}}};
 await db.query(`insert into finance_statement_verifications(id,tenant_id,import_id,actor_id,reader_version,source_revision,outcome,report) values($1,$2,$3,$4,'statement-source-v1','revision','rows_match',$5)`,[verification,i.tenant,id,i.operator,report]);
 return {id,verification,report};
}

type Review={revision:string;can_approve:boolean;current:boolean;status:string;blocking_reasons:string[];approval:{id:string;snapshot:unknown}|null;history:unknown[]};
async function read(from='2026-08-01',to='2026-08-31',actor=i.operator){return (await financeAs<{result:Review}>(db,actor,'select get_finance_statement_coverage_review($1,$2,$3,$4) result',[i.tenant,i.account,from,to])).rows[0].result;}
async function ready(){await source('2026-07-31',10000);await source('2026-08-31',10000);}
async function payload(){return {version:1,tenant_id:i.tenant,request_id:randomUUID(),account_id:i.account,from:'2026-08-01',to:'2026-08-31',revision:(await read()).revision,reason:'Originais do banco conferidos para todo o período',originals_obtained_from_bank:true,complete_period_confirmed:true};}
async function approve(p:unknown,actor=i.operator){return (await financeAs<{result:{approval_id:string}}>(db,actor,'select record_finance_statement_coverage_approval($1) result',[p])).rows[0].result;}
it('approves full days and exact evidence as human reviewed but never bank attested or closed',async()=>{
 await ready();expect(await read()).toMatchObject({status:'not_approved',current:false,can_approve:true,blocking_reasons:[]});const p=await payload(),saved=await approve(p);
 expect(saved).toMatchObject({confirmed:true,review_method:'reviewed_by_user',authenticity_status:'not_attested',can_close:false});
 expect(await read()).toMatchObject({status:'approved',current:true,can_approve:false,approval:{id:saved.approval_id,actor_id:i.operator,reason:p.reason,declarations:{originals_obtained_from_bank:true,complete_period_confirmed:true}},can_close:false});
 expect((await db.query('select * from finance_movements')).rows).toHaveLength(0);
});
it('requires both exact boolean declarations and rejects client actor or inferred truth',async()=>{
 await ready();const p=await payload();for(const change of [{originals_obtained_from_bank:false},{complete_period_confirmed:'true'},{complete_period_confirmed:null},{actor_id:i.operator}])await expect(approve({...p,...change})).rejects.toThrow(/finance_invalid_(coverage_declaration|payload)/);
 expect((await db.query('select * from finance_statement_coverage_approvals')).rows).toHaveLength(0);
});
it('replays an approval after evidence changes but cannot reuse key for different content',async()=>{
 await ready();const p=await payload(),a=await approve(p);await source('2026-08-31',10000);expect(await approve(p)).toEqual(a);
 expect(await read()).toMatchObject({status:'needs_review',current:false});await expect(approve({...p,reason:'Outra razão e mesma chave'})).rejects.toThrow('finance_request_conflict');
 expect((await db.query('select * from finance_events')).rows).toHaveLength(1);
});
it('rejects stale preview without creating approval event or command',async()=>{
 await ready();const p=await payload();await source('2026-08-31',10000);await expect(approve(p)).rejects.toThrow('finance_coverage_evidence_changed');expect((await db.query('select * from finance_commands')).rows).toHaveLength(0);
});
it('reverses permanently and requires reversal before renewing a stale approval',async()=>{
 await ready();const saved=await approve(await payload());await source('2026-08-31',10000);await expect(approve(await payload())).rejects.toThrow('finance_coverage_approval_exists');
 const p={version:1,tenant_id:i.tenant,request_id:randomUUID(),approval_id:saved.approval_id,reason:'Revisar fontes novas e preservar conferência anterior'};
 const first=await financeAs(db,i.operator,'select reverse_finance_statement_coverage_approval($1)',[p]);expect(await financeAs(db,i.operator,'select reverse_finance_statement_coverage_approval($1)',[p])).toEqual(first);
 expect(await read()).toMatchObject({status:'reversed',current:false,can_approve:true,history:[{id:saved.approval_id,reversal:{actor_id:i.operator,reason:p.reason}}]});await approve(await payload());expect((await read()).history).toHaveLength(2);
});
it('blocks missing anchors and missing declared days despite explicit declarations',async()=>{
 await source('2026-07-31',10000,'2026-08-02','2026-08-31');expect((await read()).blocking_reasons).toEqual(expect.arrayContaining(['coverage_gaps','missing_anchors']));await expect(approve(await payload())).rejects.toThrow('finance_coverage_not_eligible');
});
it('blocks conflicting anchors and unequal arithmetic',async()=>{
 await ready();await source('2026-08-31',11000);expect((await read()).blocking_reasons).toContain('conflicting_anchors');await expect(approve(await payload())).rejects.toThrow('finance_coverage_not_eligible');
});
it('blocks arithmetic mismatch even with complete declarations',async()=>{
 await source('2026-07-31',10000);await source('2026-08-31',11000);expect((await read()).blocking_reasons).toContain('balance_mismatch');
});
it('blocks current and future days regardless of reported bank anchors',async()=>{
 const today=(await db.query<{day_value:string}>("select (clock_timestamp() at time zone 'America/Sao_Paulo')::date::text as day_value")).rows[0].day_value;expect((await read(today,today)).blocking_reasons).toContain('period_not_finished');
});
it('denies drivers including mixed profiles, foreign tenant and direct modifications',async()=>{
 await ready();const p=await payload();await expect(approve(p,i.driverUser)).rejects.toThrow('finance_access_denied');await db.query("insert into tenant_memberships values($1,$2,'operator',true)",[i.tenant,i.driverUser]);await expect(approve(p,i.driverUser)).rejects.toThrow('finance_access_denied');await expect(approve({...p,tenant_id:i.otherTenant})).rejects.toThrow('finance_access_denied');
 await approve(p);await expect(financeAs(db,i.operator,'delete from finance_statement_coverage_approvals')).rejects.toThrow('permission denied');await db.exec('savepoint immutable');await expect(db.exec('delete from finance_statement_coverage_approvals')).rejects.toThrow('finance_immutable_record');await db.exec('rollback to savepoint immutable');
});
it('invalidates approval after offsetting bank entries even when net and evidence revision are unchanged',async()=>{
 await ready();const before=await read();await approve(await payload());const id=(await db.query<{id:string}>('select id from finance_statement_imports limit 1')).rows[0].id;
 for(const [row,cents] of [[1,500],[2,-500]])await db.query(`insert into finance_bank_entries(tenant_id,bank_account_id,first_import_id,source_row,posted_on,amount_cents,currency,description,raw) values($1,$2,$3,$4,'2026-08-10',$5,'BRL','Nova linha compensada','{}')`,[i.tenant,i.account,id,row,cents]);
 const after=await read();expect(after.revision).not.toBe(before.revision);expect(after).toMatchObject({status:'needs_review',current:false});
});
it('invalidates after duplicate account identity and shows noncash account requirement',async()=>{
 await ready();await approve(await payload());await db.query('insert into bank_accounts(id,tenant_id,active) values($1,$2,true)',[randomUUID(),i.tenant]);expect((await read()).blocking_reasons).toContain('source_account_unverified');expect(await read()).toMatchObject({status:'needs_review'});
 await db.query("update bank_accounts set account_type='cash' where id=$1",[i.account]);expect((await read()).blocking_reasons).toContain('bank_account_required');
});
it('rejects source rows requiring identity review',async()=>{
 await ready();const id=(await db.query<{id:string}>('select id from finance_statement_imports limit 1')).rows[0].id;await db.query(`insert into finance_statement_rows(tenant_id,import_id,source_row,raw,classification) values($1,$2,1,'{"posted_on":"2026-08-05"}','ambiguous')`,[i.tenant,id]);expect((await read()).blocking_reasons).toContain('unresolved_identity');await expect(approve(await payload())).rejects.toThrow('finance_coverage_not_eligible');
});


it('blocks non-Brazilian timezone and unverified latest source',async()=>{
 await ready();const s=await source('2026-08-31',10000);const report={...s.report,native_evidence:{...s.report.native_evidence,period:{start:{...s.report.native_evidence.period.start,offset_minutes:0},end:{...s.report.native_evidence.period.end,offset_minutes:0}}}};
 await db.query(`insert into finance_statement_verifications(tenant_id,import_id,actor_id,reader_version,source_revision,outcome,report,created_at) values($1,$2,$3,'statement-source-v1','utc','rows_match',$4,clock_timestamp()+interval '1 second')`,[i.tenant,s.id,i.operator,report]);
 expect((await read()).blocking_reasons).toContain('timezone_not_sao_paulo');await expect(approve(await payload())).rejects.toThrow('finance_coverage_not_eligible');
});
it('rolls back approval if its audit event fails',async()=>{
 await ready();const p=await payload();await db.exec(`create function public.fail_coverage_audit() returns trigger language plpgsql as $$begin if new.action='statement_coverage_approved' then raise exception 'forced_audit_failure';end if;return new;end$$;create trigger qa_coverage_audit before insert on finance_events for each row execute function public.fail_coverage_audit();`);
 await expect(approve(p)).rejects.toThrow('forced_audit_failure');expect((await db.query('select * from finance_statement_coverage_approvals')).rows).toHaveLength(0);expect((await db.query('select * from finance_commands')).rows).toHaveLength(0);
});
it('invalidates identity reversal even when reversal keeps aggregate net unchanged',async()=>{
 await ready();const s=await source('2026-08-31',10000),entry=randomUUID(),row=randomUUID(),review=randomUUID();
 await db.query(`insert into finance_bank_entries(id,tenant_id,bank_account_id,first_import_id,source_row,posted_on,amount_cents,currency,description,raw) values($1,$2,$3,$4,1,'2026-08-05',100,'BRL','Entrada','{}'),($5,$2,$3,$4,2,'2026-08-05',-100,'BRL','Saída','{}')`,[entry,i.tenant,i.account,s.id,randomUUID()]);
 await db.query(`insert into finance_statement_rows(id,tenant_id,import_id,source_row,raw,classification) values($1,$2,$3,1,'{"posted_on":"2026-08-05"}','ambiguous')`,[row,i.tenant,s.id]);
 await db.query(`insert into finance_statement_identity_reviews(id,tenant_id,row_id,decision,bank_entry_id,source_verification_id,actor_id,actor_name,reason) values($1,$2,$3,'same_transaction',$4,$5,$6,'QA','Identidade conferida manualmente')`,[review,i.tenant,row,entry,s.verification,i.operator]);
 await approve(await payload());await db.query(`insert into finance_statement_review_reversals(tenant_id,review_id,actor_id,actor_name,reason) values($1,$2,$3,'QA','Reversão auditada da decisão anterior')`,[i.tenant,review,i.operator]);
 expect(await read()).toMatchObject({status:'needs_review',current:false});expect((await read()).blocking_reasons).toContain('unresolved_identity');
});
