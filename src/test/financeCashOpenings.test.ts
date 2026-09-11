// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {createFinanceLedgerDatabase,financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:PGlite;
beforeAll(async()=>{
 db=await createFinanceLedgerDatabase();
 await db.exec(`alter table bank_accounts add column bank_code text default '001',add column branch_number text default '1234',add column account_number text default '123-4',add column account_type text default 'cash';
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
 alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;
 create function finance_private.can_read_receipt(text) returns boolean language sql as $$select true$$;`);
 for(const name of ['20260909222851_finance_statement_intake','20260909223737_finance_statement_source_verification','20260909233625_finance_audit_queries','20260910020543_finance_ofx_statement_intake','20260910021404_finance_native_statement_account','20260910130956_finance_statement_period_evidence','20260910140010_finance_account_opening_balances','20260910141240_finance_cash_opening_counts'])await db.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'));
},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db.close();});
const payload=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),account_id:i.account,effective_from:'2026-09-01',custodian_name:'Responsável do cofre',reason:'Contagem inicial de cédulas e moedas',counts:[{denomination_cents:20000,quantity:0},{denomination_cents:10000,quantity:2},{denomination_cents:25,quantity:3}]});
async function record(p:unknown=payload(),actor=i.operator){return (await financeAs<{result:{opening_id:string;balance_cents:string}}>(db,actor,'select record_finance_cash_opening($1) result',[p])).rows[0].result;}
async function read(){return (await financeAs<{result:Record<string,unknown>}>(db,i.operator,'select get_finance_account_opening($1,$2,$3,$4) result',[i.tenant,i.account,'2026-09-01','2026-09-30'])).rows[0].result;}
it('derives physical opening and preserves denomination zeros, custodian and day without money',async()=>{
 const p=payload();expect(await record(p)).toMatchObject({balance_cents:'20075',evidence_type:'cash_count_v1',confirmed:true,cash_created:false});
 const evidence={version:1,type:'cash_count_v1',currency:'BRL',effective_from:p.effective_from,timezone:'America/Sao_Paulo',counted_at_boundary:'start_of_day',custodian_name:p.custodian_name,counts:[p.counts[2],p.counts[1],p.counts[0]],total_cents:'20075'};
 expect(await read()).toMatchObject({opening:{evidence_type:'cash_count_v1',evidence,evidence_status:'valid',actor_id:i.operator},book:{opening_cents:'20075',in_cents:'0',out_cents:'0',closing_cents:'20075'},history:[{evidence_type:'cash_count_v1',evidence}],can_close:false});
 expect((await db.query('select * from finance_movements')).rows).toHaveLength(0);
 expect((await db.query('select * from finance_statement_imports')).rows).toHaveLength(0);
});
it('allows explicitly counted zero and bigint multiplication beyond int32',async()=>{
 const p=payload();expect(await record({...p,counts:[{denomination_cents:20000,quantity:999999999}]})).toMatchObject({balance_cents:'19999999980000'});
 await financeAs(db,i.operator,'select reverse_finance_account_opening($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),opening_id:(await read() as {opening:{id:string}}).opening.id,reason:'Nova contagem integralmente zerada'}]);
 expect(await record({...p,request_id:randomUUID(),counts:[{denomination_cents:1,quantity:0}]})).toMatchObject({balance_cents:'0'});
});
it('replays before mutable account and opening state while rejecting altered request',async()=>{
 const p=payload(),first=await record(p);await db.query('update bank_accounts set active=false where id=$1',[i.account]);
 expect(await record(p)).toEqual(first);
 await expect(record({...p,reason:'Outra contagem com a mesma chave'})).rejects.toThrow('finance_request_conflict');
 expect((await db.query('select * from finance_account_openings')).rows).toHaveLength(1);
 expect((await db.query('select * from finance_events')).rows).toHaveLength(1);
});
it('uses the existing single-active-opening guard and rejects OFX on cash',async()=>{
 await record();await expect(record()).rejects.toThrow('finance_account_opening_exists');
 await expect(financeAs(db,i.operator,'select record_finance_account_opening($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),account_id:i.account,from:'2026-09-01',to:'2026-09-30',revision:'x',reason:'Tentativa de abertura bancária'}])).rejects.toThrow('finance_cash_opening_requires_count');
});
it('reverses using existing RPC while preserving complete count history and audit',async()=>{
 const p=payload(),saved=await record(p);const reversal={version:1,tenant_id:i.tenant,request_id:randomUUID(),opening_id:saved.opening_id,reason:'Recontagem necessária para corrigir abertura'};
 const first=await financeAs(db,i.operator,'select reverse_finance_account_opening($1)',[reversal]);expect(await financeAs(db,i.operator,'select reverse_finance_account_opening($1)',[reversal])).toEqual(first);
 expect(await read()).toMatchObject({opening:null,book:null,history:[{evidence_type:'cash_count_v1',evidence:{custodian_name:p.custodian_name,total_cents:'20075'},reversal:{actor_id:i.operator}}]});
 await record();expect((await read()).history).toHaveLength(2);
 const audit=(await financeAs<{result:{rows:unknown[]}}>(db,i.operator,'select list_finance_audit_events($1,$2) result',[i.tenant,{manual_only:true}])).rows[0].result;expect(audit.rows).toHaveLength(3);
});
it('denies drivers, mixed roles, foreign tenant, foreign account and noncash account',async()=>{
 const p=payload();await expect(record(p,i.driverUser)).rejects.toThrow('finance_access_denied');
 await db.query("insert into tenant_memberships values($1,$2,'operator',true)",[i.tenant,i.driverUser]);await expect(record(p,i.driverUser)).rejects.toThrow('finance_access_denied');
 await expect(record({...p,tenant_id:i.otherTenant})).rejects.toThrow('finance_access_denied');
 await expect(record({...p,account_id:i.otherAccount})).rejects.toThrow('finance_cash_account_required');
 await db.query("update bank_accounts set account_type='checking' where id=$1",[i.account]);await expect(record(p)).rejects.toThrow('finance_cash_account_required');
});
it('rejects unknown fields, client total, missing custodian and future date',async()=>{
 for(const change of [{balance_cents:5},{custodian_name:''},{effective_from:'2999-01-01'},{effective_from:'2026-9-1'},{version:'1'}])await expect(record({...payload(),...change})).rejects.toThrow(/finance_invalid_(payload|period)/);
 expect((await db.query('select * from finance_commands')).rows).toHaveLength(0);
});
it('rejects negative fractional string duplicate and unknown denominations or malformed arrays',async()=>{
 for(const counts of [null,{},[],[{denomination_cents:3,quantity:1}],[{denomination_cents:100,quantity:-1}],[{denomination_cents:100,quantity:1.5}],[{denomination_cents:100,quantity:'1'}],[{denomination_cents:100,quantity:1000000000}],[{denomination_cents:100,quantity:1},{denomination_cents:100,quantity:0}],[{denomination_cents:100,quantity:1,total:100}]])await expect(record({...payload(),counts})).rejects.toThrow('finance_invalid_cash_counts');
 expect((await db.query('select * from finance_account_openings')).rows).toHaveLength(0);
});
it('retains immutable evidence and denies direct browser writes',async()=>{
 await record();await db.exec('savepoint immutable');await expect(db.exec("update finance_account_openings set evidence='{}'")).rejects.toThrow('finance_immutable_record');await db.exec('rollback to savepoint immutable');
 await expect(financeAs(db,i.operator,'delete from finance_account_openings')).rejects.toThrow('permission denied');
 await expect(financeAs(db,i.operator,'insert into finance_account_openings default values')).rejects.toThrow('permission denied');
});
it('marks a reclassified cash account for review without invoking bank source validation',async()=>{
 await record();await db.query("update bank_accounts set account_type='checking' where id=$1",[i.account]);expect(await read()).toMatchObject({opening:{evidence_type:'cash_count_v1',evidence_status:'requires_review'},can_close:false});
});
it('continues the same book using subsequent real cash movements',async()=>{
 await record();await db.query(`insert into finance_movements(tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,created_by) values($1,$2,'out','other',75,'2026-09-02','Gasto real','QA',$3)`,[i.tenant,i.account,i.operator]);
 expect(await read()).toMatchObject({book:{opening_cents:'20075',out_cents:'75',closing_cents:'20000'},can_close:false});
});
it('preserves the original bank path with explicit bank source after the query extension',async()=>{
 await db.query("update bank_accounts set account_type='checking' where id=$1",[i.account]);
 const id=randomUUID(),hash=id.replace(/-/g,'').repeat(2),stamp=(date:string,time:string)=>({date,raw:date.replace(/-/g,'')+time+'[-3:BRT]',offset_minutes:-180});
 await db.query(`insert into finance_statement_imports(id,tenant_id,bank_account_id,file_hash,source_path,file_name,source_snapshot,parser_version,mapping,period_start,period_end,currency,input_rows,created_by) values($1,$2,$3,$4,'path','bank.ofx','{}','native-ofx-v1','{}','2026-08-01','2026-08-31','BRL',0,$5)`,[id,i.tenant,i.account,hash,i.operator]);
 const report={hash_verified:true,actual_hash:hash,identity_trust:'native_file_identifier',native_evidence:{parser_version:'native-ofx-v1',currency:'BRL',account:{bank_id:'001',branch_id:'1234',account_id:'123-4',account_type:'CHECKING'},outside_declared_period:false,repeated_bank_ids:[],period:{start:stamp('2026-08-01','000000'),end:stamp('2026-08-31','235959')},ledger_balance:{amount_cents:-500,as_of:stamp('2026-08-31','235959')}}};
 await db.query(`insert into finance_statement_verifications(tenant_id,import_id,actor_id,reader_version,source_revision,outcome,report) values($1,$2,$3,'statement-source-v1','revision','rows_match',$4)`,[i.tenant,id,i.operator,report]);
 const evidence=(await financeAs<{result:{revision:string}}>(db,i.operator,'select get_finance_statement_period_evidence($1,$2,$3,$4) result',[i.tenant,i.account,'2026-09-01','2026-09-30'])).rows[0].result;
 await financeAs(db,i.operator,'select record_finance_account_opening($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),account_id:i.account,from:'2026-09-01',to:'2026-09-30',revision:evidence.revision,reason:'Abertura bancária preservada após nova contagem'}]);
 expect(await read()).toMatchObject({opening:{evidence_type:'bank_statement_v1',evidence_status:'valid',evidence:{opening_anchors:[{import_id:id,cents:'-500'}]}},book:{opening_cents:'-500'},history:[{evidence_type:'bank_statement_v1'}],can_close:false});
});
