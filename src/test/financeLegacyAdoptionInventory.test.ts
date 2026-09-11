// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect,vi} from 'vitest';
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
import {legacyInventorySchema} from '@/lib/financial/legacyInventoryClient';
import {createFinanceLedgerDatabase,financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:PGlite;
type Row={source_table:string;source_id:string;amount_cents:string|null;context:Record<string,unknown>};
type Inventory={total:number;rows:Row[];counts_by_source:Record<string,number>;unknown_account:{total:number;rows:Row[];not_additive_across_accounts:boolean};legacy_integration_status:string;can_close:boolean};
beforeAll(async()=>{
 db=await createFinanceLedgerDatabase();const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const type of baseline.matchAll(/CREATE TYPE public\.[a-z_]+ AS ENUM \([\s\S]*?\);/g))await db.exec(type[0]);
 for(const table of ['bank_transactions','receivables_payments','payables_payments','driver_settlement_payments','closing_report_payments','load_payments','employee_advances','payables','payroll_entry_items']){
  const create=baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];if(!create)throw new Error(table);await db.exec(create);
  const defaults=baseline.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ALTER COLUMN[\\s\\S]*?;`))?.[0];if(defaults)await db.exec(defaults);await db.exec(`alter table ${table} add primary key(id)`);
 }
 await db.exec(`alter table closing_report_payments add column canonical_receivable_payment_id uuid;
 alter table load_payments add column receivable_payment_id uuid,add column bank_transaction_id uuid;`);
 // Real candidate table definitions. Referential constraints to command/graph
 // tables are omitted: this fixture tests reads, including damaged legacy rows.
 for(const [file,table] of [
  ['20260830183929_audit_receivable_payments_and_reversals','receivable_payment_reversals'],
  ['20260910024438_finance_receivable_movement_projection','finance_receivable_movement_links'],
  ['20260910002244_finance_payable_movement_links','finance_payable_movement_links'],
  ['20260910003529_finance_payable_link_reversal','finance_payable_link_reversals'],
  ['20260910130540_finance_settlement_movement_links','finance_settlement_movement_links'],
  ['20260910132411_finance_settlement_link_reversals','finance_settlement_link_reversals']]){
  const sql=readFileSync(`supabase/migrations/${file}.sql`,'utf8');let create=sql.match(new RegExp(`create table public\\.${table}\\s*\\([\\s\\S]*?\\n\\);`,'i'))?.[0];if(!create)throw new Error(table);
  create=create.replace(/,\s*foreign key\([^;]+?(?=,\s*foreign key|\s*\n\);)/gi,'').replace(/ references public\.\w+\([^)]*\)/g,'');await db.exec(create);
 }
 await db.exec(readFileSync('supabase/migrations/20260910142740_finance_legacy_adoption_inventory.sql','utf8'));
},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db.close();});
async function read(page=1,actor=i.operator,account=i.account){const result=(await financeAs<{result:Inventory}>(db,actor,'select get_finance_legacy_adoption_inventory($1,$2,$3,$4,$5) result',[i.tenant,account,'2026-09-01','2026-09-30',page])).rows[0].result;legacyInventorySchema.parse(result);return result;}
async function payment(kind='receivables_payments',bank:string|null=null,amount=12.34){
 const id=randomUUID(),incoming=kind==='receivables_payments';await db.query(`insert into ${kind}(id,tenant_id,${incoming?'receivable_id':'payable_id'},amount,${incoming?'received_at':'paid_at'},bank_account_id,method,bank_transaction_id) values($1,$2,$3,$4,'2026-09-10T12:00:00Z',$5,'pix',$6)`,[id,i.tenant,randomUUID(),amount,i.account,bank]);return id;
}
async function bank(){const id=randomUUID();await db.query(`insert into bank_transactions(id,tenant_id,bank_account_id,posted_at,amount,transaction_type,raw_payload) values($1,$2,$3,'2026-09-10T12:00:00Z',12.34,'credit','{}')`,[id,i.tenant,i.account]);return id;}
it('returns empty diagnostics without claiming integration or closing',async()=>{
 expect(await read()).toMatchObject({total:0,rows:[],counts_by_source:{},unknown_account:{total:0,not_additive_across_accounts:true},legacy_integration_status:'not_reviewed',can_close:false});
});
it('excludes exact bank/load/closing projections and keeps the primary unmapped receipt',async()=>{
 const tx=await bank(),p=await payment(undefined,tx);
 await db.query(`insert into load_payments(tenant_id,load_id,receivable_id,payment_date,amount,bank_account_id,receivable_payment_id,bank_transaction_id) values($1,$2,$3,'2026-09-10',12.34,$4,$5,$6)`,[i.tenant,randomUUID(),randomUUID(),i.account,p,tx]);
 await db.query(`insert into closing_report_payments(tenant_id,closing_report_id,payment_date,amount,bank_account_id,canonical_receivable_payment_id) values($1,$2,'2026-09-10',12.34,$3,$4)`,[i.tenant,randomUUID(),i.account,p]);
 expect((await read()).rows).toEqual([expect.objectContaining({source_table:'receivables_payments',source_id:p,amount_cents:'1234'})]);
 await db.query(`insert into finance_receivable_movement_links values($1,$2,$3,$4,$5,'receive',now())`,[i.tenant,randomUUID(),p,tx,randomUUID()]);expect((await read()).total).toBe(0);
});
it('does not deduplicate legacy projection solely by shared receivable, value or date',async()=>{
 await payment();await db.query(`insert into closing_report_payments(tenant_id,closing_report_id,payment_date,amount,bank_account_id) values($1,$2,'2026-09-10',12.34,$3)`,[i.tenant,randomUUID(),i.account]);
 expect((await read()).total).toBe(2);
});
it('keeps refund as separate history until its exact reverse command is mapped',async()=>{
 const p=await payment(),r=randomUUID(),cmd=randomUUID(),tx=await bank();
 await db.query(`insert into receivable_payment_reversals(id,tenant_id,receivable_id,payment_id,bank_transaction_id,financial_command_id,amount,effective_at,reason,created_by) values($1,$2,$3,$4,$5,$6,12.34,'2026-09-11T12:00:00Z','Devolução registrada',$7)`,[r,i.tenant,randomUUID(),p,tx,cmd,i.operator]);expect((await read()).total).toBe(2);
 await db.query(`insert into finance_receivable_movement_links values($1,$2,$3,$4,$5,'reverse',now())`,[i.tenant,cmd,p,tx,randomUUID()]);expect((await read()).rows.map(x=>x.source_table)).toEqual(['receivables_payments']);
});
it('does not resurrect a payable payment with a historical canonical link',async()=>{
 const p=await payment('payables_payments'),l=randomUUID();await db.query(`insert into finance_payable_movement_links(id,tenant_id,movement_id,payable_id,payment_id,amount_cents,created_by) values($1,$2,$3,$4,$5,1234,$6)`,[l,i.tenant,randomUUID(),randomUUID(),p,i.operator]);
 await db.query(`insert into finance_payable_link_reversals(tenant_id,link_id,created_by,actor_name,reason) values($1,$2,$3,'QA','Reversão da alocação antiga')`,[i.tenant,l,i.operator]);expect((await read()).total).toBe(0);
});
it('shows settlement without account separately, including when its old link was reversed',async()=>{
 const p=randomUUID(),s=randomUUID(),l=randomUUID();await db.query(`insert into driver_settlement_payments(id,tenant_id,settlement_id,amount,paid_at) values($1,$2,$3,15,'2026-09-10T12:00:00Z')`,[p,i.tenant,s]);
 let r=await read();expect(r.total).toBe(0);expect(r.unknown_account.rows).toEqual([expect.objectContaining({source_id:p,amount_cents:'1500'})]);
 await db.query(`insert into finance_settlement_movement_links(id,tenant_id,settlement_id,payment_id,movement_id,amount_cents,created_by) values($1,$2,$3,$4,$5,1500,$6)`,[l,i.tenant,s,p,randomUUID(),i.operator]);expect((await read()).unknown_account.total).toBe(0);
 await db.query(`insert into finance_settlement_link_reversals(tenant_id,link_id,created_by,actor_name,reason) values($1,$2,$3,'QA','Corrigir associação antiga')`,[i.tenant,l,i.operator]);r=await read();expect(r.unknown_account.total).toBe(1);expect(r.total).toBe(0);
});
it('paid advance status alone never manufactures an amount of cash',async()=>{
 await db.query(`insert into employee_advances(tenant_id,employee_id,amount,advance_date,status) values($1,$2,90,'2026-09-10','paid')`,[i.tenant,randomUUID()]);
 const r=await read();expect(r.unknown_account.rows[0]).toMatchObject({source_table:'employee_advances',amount_cents:null,context:{amount_status:'paid_status_only'}});
});
it('keeps a paid advance with only partial payment unresolved without manufacturing its remainder',async()=>{
 const a=randomUUID(),title=randomUUID();await db.query(`insert into employee_advances(id,tenant_id,employee_id,amount,advance_date,status,payable_id) values($1,$2,$3,90,'2026-09-10','paid',$4)`,[a,i.tenant,randomUUID(),title]);
 await db.query(`insert into payables(id,tenant_id,supplier_name,category,description,amount,due_date) values($1,$2,'QA','other','Adiantamento',90,'2026-09-10')`,[title,i.tenant]);
 const p=await payment('payables_payments',null,50);await db.query('update payables_payments set payable_id=$1 where id=$2',[title,p]);
 const r=await read();expect(r.total).toBe(1);expect(r.unknown_account.rows[0]).toMatchObject({source_id:a,amount_cents:null,reason:'paid_advance_payment_evidence_incomplete'});
});
it('paginates deterministically at 30 without including other account or dates',async()=>{
 for(let n=0;n<31;n++)await bank();expect((await read()).rows).toHaveLength(30);const second=await read(2);expect(second.total).toBe(31);expect(second.rows).toHaveLength(1);expect((await read()).rows.map(r=>r.source_id)).not.toContain(second.rows[0].source_id);
 await db.query("update bank_transactions set posted_at='2026-10-01' where id=$1",[second.rows[0].source_id]);expect((await read()).total).toBe(30);
});
it('denies driver, mixed profile, foreign account and invalid pagination',async()=>{
 await expect(read(1,i.driverUser)).rejects.toThrow('finance_access_denied');await db.query("insert into tenant_memberships values($1,$2,'operator',true)",[i.tenant,i.driverUser]);await expect(read(1,i.driverUser)).rejects.toThrow('finance_access_denied');
 await expect(read(1,i.operator,i.otherAccount)).rejects.toThrow('finance_account_not_found');await expect(read(0)).rejects.toThrow('finance_invalid_filters');
});
it('EXPLAIN ANALYZE executes the real candidate query on representative sources',async()=>{
 await bank();await payment();const body=(await db.query<{prosrc:string}>("select prosrc from pg_proc where oid='finance_private.legacy_adoption_candidates(uuid,uuid,date,date)'::regprocedure")).rows[0].prosrc;
 const sql=body.replace(/\b_tenant\b/g,'$1::uuid').replace(/\b_account\b/g,'$2::uuid').replace(/\b_from\b/g,'$3::date').replace(/\b_to\b/g,'$4::date');
 const result=await db.query(`explain (analyze,format json) ${sql}`,[i.tenant,i.account,'2026-09-01','2026-09-30']);
 expect(JSON.stringify(result.rows)).toContain('Actual Rows');expect(JSON.stringify(result.rows)).toContain('Append');expect((await read()).total).toBe(2);
});
it('does not reinterpret an untraced already_paid payroll projection as money',async()=>{
 const p=randomUUID();await db.query(`insert into payroll_entry_items(payroll_period_id,employee_id,tenant_id,payroll_entry_id,item_type,nature,description,amount,competence_date) values(gen_random_uuid(),gen_random_uuid(),$1,$2,'other','already_paid','Histórico sem origem',123,'2026-09-10')`,[i.tenant,p]);
 const r=await read();expect(r.total).toBe(0);expect(r.unknown_account.rows[0]).toMatchObject({source_table:'payroll_entry_items',amount_cents:null});
});
it('keeps imprecise legacy money visible without rounding it into cents',async()=>{
 await payment('payables_payments',null,12.345);const r=await read();expect(r.rows[0]).toMatchObject({amount_cents:null,context:{amount_status:'invalid_or_unknown'}});
});
it('excludes a payroll already_paid projection only when its exact payment ID exists',async()=>{
 const p=randomUUID();await db.query(`insert into driver_settlement_payments(id,tenant_id,settlement_id,amount,paid_at) values($1,$2,$3,20,'2026-09-10T12:00:00Z')`,[p,i.tenant,randomUUID()]);
 await db.query(`insert into payroll_entry_items(tenant_id,payroll_period_id,payroll_entry_id,employee_id,item_type,nature,description,amount,competence_date,source_table,source_id) values($1,$2,$3,$4,'other','already_paid','Histórico rastreado',20,'2026-09-10','driver_settlement_payments',$5)`,[i.tenant,randomUUID(),randomUUID(),randomUUID(),p]);
 expect((await read()).unknown_account.rows.map(r=>r.source_table)).toEqual(['driver_settlement_payments']);
});
