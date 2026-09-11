// @vitest-environment node
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {legacyIntegritySchema} from '@/lib/financial/legacyIntegrityContract';
import {createLegacyIntegrityDatabase} from './helpers/legacyIntegrityDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:PGlite;
type Inventory=ReturnType<typeof legacyIntegritySchema.parse>;
beforeAll(async()=>{db=await createLegacyIntegrityDatabase();},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db.close();});
async function read(page=1,actor=i.operator){const result=(await financeAs<{result:Inventory}>(db,actor,'select get_finance_legacy_integrity_inventory($1,$2) result',[i.tenant,page])).rows[0].result;return legacyIntegritySchema.parse(result);}
async function payment(kind='receivables_payments',bank:string|null=null,amount=12.34){
 const id=randomUUID(),incoming=kind==='receivables_payments';await db.query(`insert into ${kind}(id,tenant_id,${incoming?'receivable_id':'payable_id'},amount,${incoming?'received_at':'paid_at'},bank_account_id,method,bank_transaction_id) values($1,$2,$3,$4,'2026-09-10T12:00:00Z',$5,'pix',$6)`,[id,i.tenant,randomUUID(),amount,i.account,bank]);return id;
}
async function bank(){const id=randomUUID();await db.query(`insert into bank_transactions(id,tenant_id,bank_account_id,posted_at,amount,transaction_type,raw_payload) values($1,$2,$3,'2026-09-10T12:00:00Z',12.34,'credit','{}')`,[id,i.tenant,i.account]);return id;}
const ids=(result:Inventory)=>[...result.identified_account.rows,...result.unknown_account.rows].map(row=>row.source_id);
it('diagnoses the missing undated already_paid source in the account-period inventory',async()=>{
 const id=randomUUID();await db.query(`insert into payroll_entry_items(id,tenant_id,payroll_period_id,payroll_entry_id,employee_id,item_type,nature,description,amount) values($1,$2,$3,$4,$5,'other','already_paid','Origem sem datas',123)`,[id,i.tenant,randomUUID(),randomUUID(),randomUUID()]);
 expect((await db.query('select id from payroll_entry_items where id=$1',[id])).rows).toHaveLength(1);
 expect(ids(await read())).toContain(id);
});
it('diagnoses exclusion of a legacy payment with a non-finite timestamp',async()=>{
 const id=await payment();await db.query("update receivables_payments set received_at='infinity'::timestamptz where id=$1",[id]);expect(ids(await read())).toContain(id);
});
it('diagnoses disappearance of a receipt pointing to a non-existent account',async()=>{
 const id=await payment();await db.query('update receivables_payments set bank_account_id=$1 where id=$2',[randomUUID(),id]);
 expect(ids(await read())).toContain(id);
});
it('diagnoses disappearance when the stored account ID belongs to another tenant',async()=>{
 const id=await payment();await db.query('update receivables_payments set bank_account_id=$1 where id=$2',[i.otherAccount,id]);
 expect(ids(await read())).toContain(id);
});
it('diagnoses suppression of an inconsistent load alias merely because its payment ID exists',async()=>{
 const p=await payment(),id=randomUUID();await db.query(`insert into load_payments(id,tenant_id,load_id,payment_date,amount,bank_account_id,receivable_payment_id) values($1,$2,$3,'2026-09-10',99,$4,$5)`,[id,i.tenant,randomUUID(),i.account,p]);
 const result=await read();expect(ids(result)).toContain(p);expect(ids(result)).toContain(id);
});
it('diagnoses suppression of a bank row by a payment outside the period despite different source dates',async()=>{
 const tx=await bank(),p=await payment(undefined,tx);await db.query("update receivables_payments set received_at='2026-08-01T12:00:00Z' where id=$1",[p]);
 expect(ids(await read())).toContain(tx);expect(ids(await read())).toContain(p);
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
 const first=await read(),second=await read(2);expect(first.total).toBe(31);expect(first.unknown_account.total).toBe(31);expect([...first.unknown_account.rows,...second.unknown_account.rows].map(row=>row.source_id).sort()).toEqual(seeded.sort());
 await expect(read(1,i.driverUser)).rejects.toThrow('finance_access_denied');await db.query("insert into tenant_memberships values($1,$2,'operator',true)",[i.tenant,i.driverUser]);await expect(read(1,i.driverUser)).rejects.toThrow('finance_access_denied');
});
it('classifies nonfinite dates and invalid money without fabricating cents',async()=>{
 const id=await payment();await db.query("update receivables_payments set received_at='-infinity',amount='NaN' where id=$1",[id]);
 const row=(await read()).identified_account.rows.find(r=>r.source_id===id)!;
 expect(row).toMatchObject({date_status:'nonfinite',occurred_on:null,raw_date:'-infinity',raw_amount:'NaN',amount_cents:null});
 expect(row.issues).toEqual(expect.arrayContaining(['date_nonfinite','amount_invalid']));
});
it('handles a source ID without a source table as an orphan instead of aborting the inventory',async()=>{
 const id=randomUUID();await db.query(`insert into payroll_entry_items(id,tenant_id,payroll_period_id,payroll_entry_id,employee_id,item_type,nature,description,amount,source_id) values($1,$2,$3,$4,$5,'other','already_paid','Origem sem tabela',123,$6)`,[id,i.tenant,randomUUID(),randomUUID(),randomUUID(),randomUUID()]);
 const row=(await read()).unknown_account.rows.find(r=>r.source_id===id)!;
 expect(row.amount_cents).toBeNull();expect(row.issues).toContain('money_source_missing');
});
it('omits an intact receipt and exact load alias and exposes the alias once its amount diverges',async()=>{
 const receipt=await payment();const parent=(await db.query<{receivable_id:string}>('select receivable_id from receivables_payments where id=$1',[receipt])).rows[0].receivable_id;
 await db.query("insert into receivables(id,tenant_id,amount,status) values($1,$2,12.34,'received')",[parent,i.tenant]);
 const load=randomUUID(),alias=randomUUID();await db.query("insert into loads(id,tenant_id,load_number,status) values($1,$2,'QA','pending')",[load,i.tenant]);
 await db.query("insert into load_payments(id,tenant_id,load_id,payment_date,amount,bank_account_id,receivable_payment_id) values($1,$2,$3,'2026-09-10',12.34,$4,$5)",[alias,i.tenant,load,i.account,receipt]);
 expect((await read()).total).toBe(0);
 await db.query('update load_payments set amount=99 where id=$1',[alias]);
 const result=await read();expect(ids(result)).toEqual([alias]);expect(result.identified_account.rows[0].issues).toEqual(['receipt_alias_mismatch']);
});
it('does not reveal another tenant rows or approve empty diagnostics',async()=>{
 const id=await payment();await db.query('update receivables_payments set tenant_id=$1 where id=$2',[i.otherTenant,id]);
 expect(await read()).toMatchObject({total:0,can_close:false,legacy_integration_status:'not_reviewed'});
 await expect(read(0)).rejects.toThrow('finance_invalid_filters');
});
