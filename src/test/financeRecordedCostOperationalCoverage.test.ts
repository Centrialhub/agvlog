// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createRecordedCostOperationalCoverageDatabase} from './helpers/recordedCostOperationalCoverageDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {recordedCostOperationalCoverageSchema} from '@/lib/financial/recordedCostOperationalCoverageContract';
let db:Awaited<ReturnType<typeof createRecordedCostOperationalCoverageDatabase>>;
beforeAll(async()=>{db=await createRecordedCostOperationalCoverageDatabase();},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function read(from:string|null=null,to:string|null=null,actor=i.operator){return recordedCostOperationalCoverageSchema.parse((await financeAs<{v:unknown}>(db,actor,'select get_finance_recorded_cost_operational_coverage($1,$2,$3) v',[i.tenant,from,to])).rows[0].v);}
it('recognizes an audited maintenance claim without adding purchase, payment or consumption again',async()=>{
 const order=randomUUID(),part=randomUUID(),batch=randomUUID(),cost=randomUUID();
 await db.query("insert into maintenance_orders(id,tenant_id,order_number,status,opened_at,parts_cost,labor_cost,total_cost) values($1,$2,'OS 1','completed','2026-01-10',50,50,100)",[order,i.tenant]);
 await db.query("insert into maintenance_parts(id,tenant_id,maintenance_order_id,item_description,quantity,unit_cost,total_cost) values($1,$2,$3,'Peça direta',1,50,50)",[part,i.tenant,order]);
 await db.query("insert into finance_expense_batches(id,tenant_id,context,description,created_by) values($1,$2,'maintenance','OS 1',$3)",[batch,i.tenant,i.operator]);
 await db.query("insert into finance_expense_items(id,tenant_id,batch_id,category,description,amount_cents,occurred_on,supplier_name,no_receipt_reason,created_by) values($1,$2,$3,'service','Mão de obra',5000,'2026-01-10','Oficina','Documento conferido',$4)",[cost,i.tenant,batch,i.operator]);
 await db.query("insert into finance_maintenance_cost_claims(tenant_id,cost_id,source_kind,source_id,link_id) values($1,$2,'labor',$3,$4)",[i.tenant,cost,order,randomUUID()]);
 const result=await read('2026-01-01','2026-01-31');
 expect(result).toMatchObject({recognized_cost_count:1,recognized_cost_cents:'5000',double_counted_cents:'0',totals_additive:false,review_pending_count:1,maintenance:{labor:{covered_count:1,pending_count:0},direct_parts:{covered_count:0,pending_count:1},ambiguous_order_count:0}});
});
it('keeps unresolved and other-tenant sources as counts, enforces period and blocks the driver role',async()=>{
 await db.query("insert into maintenance_orders(id,tenant_id,order_number,status,opened_at,parts_cost,labor_cost,total_cost) values(gen_random_uuid(),$1,'Pendente','completed','2026-02-10',0,25,25)",[i.tenant]);
 await db.query("insert into maintenance_orders(id,tenant_id,order_number,status,opened_at,parts_cost,labor_cost,total_cost) values(gen_random_uuid(),$1,'Outro','completed','2026-02-10',0,99,99)",[i.otherTenant]);
 expect(await read('2026-02-01','2026-02-28')).toMatchObject({recognized_cost_count:0,recognized_cost_cents:'0',review_pending_count:1,maintenance:{labor:{covered_count:0,pending_count:1}}});
 expect(await read('2026-01-01','2026-01-31')).toMatchObject({review_pending_count:0});
 await expect(read(null,null,i.driverUser)).rejects.toThrow('finance_access_denied');await expect(read('2026-03-01','2026-02-01')).rejects.toThrow('finance_invalid_cost_filters');
 await db.query('update tenant_memberships set active=false where tenant_id=$1 and user_id=$2',[i.tenant,i.operator]);await expect(read()).rejects.toThrow('finance_access_denied');
});
