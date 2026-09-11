// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createLegacyExpenseCostDatabase} from './helpers/legacyExpenseCostDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {maintenanceCostContextSchema} from '@/lib/financial/maintenanceCostContextContract';
let db:Awaited<ReturnType<typeof createLegacyExpenseCostDatabase>>;const order=randomUUID(),item=randomUUID();
beforeAll(async()=>{db=await createLegacyExpenseCostDatabase();await db.exec(readFileSync('supabase/migrations/20260910160441_finance_maintenance_cost_context.sql','utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("insert into maintenance_orders(id,tenant_id,order_number,opened_at,parts_cost,labor_cost,total_cost) values($1,$2,'OS QA','2026-01-20T12:00:00Z',10,20,30)",[order,i.tenant]);await db.query("insert into stock_items(id,tenant_id,name,category,unit) values($1,$2,'Peça QA','parts','unit')",[item,i.tenant]);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function read(page=1,id=order){return maintenanceCostContextSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select get_finance_maintenance_cost_context($1,$2,$3) result',[i.tenant,id,page])).rows[0].result);}
async function movement(){const id=randomUUID();await db.query("insert into stock_movements(id,tenant_id,stock_item_id,maintenance_order_id,movement_type,quantity,unit_cost,total_cost,reason,moved_at) values($1,$2,$3,$4,'out',1,10,10,'Consumo na OS','2026-01-20T12:00:00Z')",[id,i.tenant,item,order]);return id;}
async function part(stock:string|null=null){const id=randomUUID();await db.query("insert into maintenance_parts(id,tenant_id,maintenance_order_id,stock_item_id,stock_movement_id,item_description,quantity,unit_cost,total_cost) values($1,$2,$3,$4,$5,'Peça QA',1,10,10)",[id,i.tenant,order,item,stock]);return id;}
it('shows coherent linked components without inventing financial cost or payment',async()=>{
 const stock=await movement();await part(stock);const result=await read();
 expect(result).toMatchObject({coverage_complete:false,recognized_cost_cents:null,parts:{total:1},stock:{total:1},header:{parts_cents:'1000',labor_cents:'2000',total_cents:'3000'}});
 expect(result.parts.rows[0].issues).toEqual([]);expect(result.stock.rows[0].issues).toEqual(['stock_movement_not_a_payment']);
 expect((await db.query('select * from finance_movements')).rows).toHaveLength(0);expect((await db.query('select * from payables')).rows).toHaveLength(0);
});
it('counts all components beyond 1000 with stable revision across pages',async()=>{
 await db.query("insert into maintenance_parts(tenant_id,maintenance_order_id,item_description,quantity,unit_cost,total_cost) select $1,$2,'Peça '||n,1,10,10 from generate_series(1,1005)n",[i.tenant,order]);
 const first=await read(),last=await read(34);expect(first.parts.total).toBe(1005);expect(first.parts.rows).toHaveLength(30);expect(last.parts.rows).toHaveLength(15);expect(first.revision).toBe(last.revision);expect(first.header.issues).toContain('header_parts_mismatch');
 await db.query("update maintenance_parts set quantity=2 where id=$1",[last.parts.rows[0].id]);expect((await read()).revision).not.toBe(first.revision);
});
it('identifies reused and mismatched stock links and preserves invalid values as unknown',async()=>{
 const stock=await movement();await part(stock);const second=await part(stock);
 await db.query("update maintenance_parts set quantity=2,unit_cost='NaN' where id=$1",[second]);await db.query("update stock_movements set moved_at='infinity' where id=$1",[stock]);
 const result=await read();expect(result.parts.rows.every(p=>p.issues.includes('stock_movement_reused'))).toBe(true);
 const invalid=result.parts.rows.find(p=>p.id===second)!;expect(invalid.unit_cost_cents).toBeNull();expect(invalid.issues).toContain('part_stock_mismatch');expect(result.stock.rows[0].occurred_on).toBeNull();
});
it('does not reveal foreign source details and rejects driver or invalid context',async()=>{
 const foreign=randomUUID();await db.query("insert into stock_movements(id,tenant_id,stock_item_id,movement_type,quantity,reason) values($1,$2,$3,'out',1,'Privado')",[foreign,i.otherTenant,item]);await part(foreign);
 const result=await read();expect(result.stock.total).toBe(0);expect(result.parts.rows[0].issues).toContain('stock_movement_missing');
 await expect(read(0)).rejects.toThrow('finance_invalid_filters');await expect(read(1,randomUUID())).rejects.toThrow('finance_maintenance_order_not_found');
 await expect(financeAs(db,i.driverUser,'select get_finance_maintenance_cost_context($1,$2)',[i.tenant,order])).rejects.toThrow('finance_access_denied');
});
