// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {createFinanceAuditDatabase} from './helpers/financeAuditRemediationDatabase';
import {financeIds as i} from './helpers/financeLedgerDatabase';
import {parseInvoicePage} from '@/lib/financial/clientInvoiceList';
let db:Awaited<ReturnType<typeof createFinanceAuditDatabase>>;const client=randomUUID();
beforeAll(async()=>{db=await createFinanceAuditDatabase();await db.exec('create index on receivables(id);create index on client_invoices(id);create index on clients(id);create index on receivables(tenant_id,client_invoice_id);create index on client_invoice_charges(tenant_id,invoice_id);create index on closing_reports(tenant_id,client_invoice_id);create index on closing_reports(tenant_id,receivable_id)');},30000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:i.operator,role:'authenticated',active_tenant_id:i.tenant})]);await db.query("insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'operator',true)",[i.tenant,i.operator]);await db.query("insert into clients(id,tenant_id,company_name,tax_id) values($1,$2,'Cliente QA','123')",[client,i.tenant]);});
afterEach(async()=>{await db.exec('rollback');});
async function seed(n:number){await db.query(`insert into client_invoices(id,tenant_id,client_id,invoice_number,installment_number,issue_date,due_date,gross_amount,discount_amount,interest_amount,total_amount,status,created_at,receivable_id)
 select md5('invoice-'||x)::uuid,$1,$2,'FAT-'||lpad(x::text,5,'0'),1,'2026-09-01','2026-09-02',100,0,0,100,'generated','2026-09-01'::timestamptz+interval '1 second'*x,md5('receivable-'||x)::uuid from generate_series(1,$3::integer) x`,[i.tenant,client,n]);await db.query("insert into receivables(id,tenant_id,client_id,client_invoice_id,amount,status,received_amount,created_at,updated_at) select receivable_id,tenant_id,client_id,id,total_amount,'invoiced',0,now(),now() from client_invoices");}
async function read(page=1,search='',revision:string|null=null){const filters={search,status:'all',client:'all'};const raw=(await db.query<{v:unknown}>('select list_client_invoice_financial_page($1,$2,$3,$4) v',[i.tenant,filters,page,revision])).rows[0].v;return parseInvoicePage(raw,i.tenant,i.operator,filters,page);}
it.each([501,10000])('covers all %i invoices in totals and search while returning only 30 rows',async n=>{
 await seed(n);await db.exec("analyze");const first=await read();expect(first).toMatchObject({total:n,invalid_count:0,totals:{open:String(n*10000),paid:'0'}});expect(first.rows).toHaveLength(30);
 const last=await read(Math.ceil(n/30),'',first.revision);expect(last.rows.at(-1)).toMatchObject({invoice_number:'FAT-00001',requires_reconciliation:false,open_amount:100});
 expect(await read(1,'FAT-00001')).toMatchObject({total:1,invalid_count:0});
},30000);
it('signals a changed snapshot instead of silently mixing pages',async()=>{await seed(31);const first=await read();await db.query("update client_invoices set notes='Alterada' where invoice_number='FAT-00001'");await expect(read(2,'',first.revision)).rejects.toThrow('finance_invoice_list_changed');});
