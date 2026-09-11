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
const ids=(result:Inventory)=>[...result.rows,...result.unknown_account.rows].map(row=>row.source_id);
it('reproduces the missing undated already_paid source in the account-period inventory',async()=>{
 const id=randomUUID();await db.query(`insert into payroll_entry_items(id,tenant_id,payroll_period_id,payroll_entry_id,employee_id,item_type,nature,description,amount) values($1,$2,$3,$4,$5,'other','already_paid','Origem sem datas',123)`,[id,i.tenant,randomUUID(),randomUUID(),randomUUID()]);
 expect((await db.query('select id from payroll_entry_items where id=$1',[id])).rows).toHaveLength(1);
 expect(ids(await read())).not.toContain(id);
});
it('reproduces exclusion of a legacy payment with a non-finite timestamp',async()=>{
 const id=await payment();await db.query("update receivables_payments set received_at='infinity'::timestamptz where id=$1",[id]);expect(ids(await read())).not.toContain(id);
});
it('reproduces disappearance of a receipt pointing to a non-existent account',async()=>{
 const id=await payment();await db.query('update receivables_payments set bank_account_id=$1 where id=$2',[randomUUID(),id]);
 expect(ids(await read())).not.toContain(id);
});
it('reproduces disappearance when the stored account ID belongs to another tenant',async()=>{
 const id=await payment();await db.query('update receivables_payments set bank_account_id=$1 where id=$2',[i.otherAccount,id]);
 expect(ids(await read())).not.toContain(id);await expect(read(1,i.operator,i.otherAccount)).rejects.toThrow('finance_account_not_found');
});
it('reproduces suppression of an inconsistent load alias merely because its payment ID exists',async()=>{
 const p=await payment(),id=randomUUID();await db.query(`insert into load_payments(id,tenant_id,load_id,payment_date,amount,bank_account_id,receivable_payment_id) values($1,$2,$3,'2026-09-10',99,$4,$5)`,[id,i.tenant,randomUUID(),i.account,p]);
 const result=await read();expect(ids(result)).toContain(p);expect(ids(result)).not.toContain(id);
});
it('reproduces suppression of a bank row by a payment outside the period despite different source dates',async()=>{
 const tx=await bank(),p=await payment(undefined,tx);await db.query("update receivables_payments set received_at='2026-08-01T12:00:00Z' where id=$1",[p]);
 expect(ids(await read())).not.toContain(tx);expect(ids(await read())).not.toContain(p);
});
it('keeps an orphan alias and refuses cross-tenant ID equivalence',async()=>{
 const p=await payment();await db.query('update receivables_payments set tenant_id=$1,bank_account_id=$2 where id=$3',[i.otherTenant,i.otherAccount,p]);
 const id=randomUUID();await db.query(`insert into closing_report_payments(id,tenant_id,closing_report_id,payment_date,amount,bank_account_id,canonical_receivable_payment_id) values($1,$2,$3,'2026-09-10',12.34,$4,$5)`,[id,i.tenant,randomUUID(),i.account,p]);
 const result=await read();expect(ids(result)).toContain(id);expect(ids(result)).not.toContain(p);
});
it('does not hide dated unknown-account records at a page boundary or expose them to mixed drivers',async()=>{
 const seeded=[];for(let n=0;n<31;n++){
  const id=randomUUID();seeded.push(id);await db.query(`insert into driver_settlement_payments(id,tenant_id,settlement_id,amount,paid_at) values($1,$2,$3,10,'2026-09-10T12:00:00Z')`,[id,i.tenant,randomUUID()]);
 }
 const first=await read(),second=await read(2);expect(first.total).toBe(0);expect(first.unknown_account.total).toBe(31);expect([...first.unknown_account.rows,...second.unknown_account.rows].map(row=>row.source_id).sort()).toEqual(seeded.sort());
 await expect(read(1,i.driverUser)).rejects.toThrow('finance_access_denied');await db.query("insert into tenant_memberships values($1,$2,'operator',true)",[i.tenant,i.driverUser]);await expect(read(1,i.driverUser)).rejects.toThrow('finance_access_denied');
});
