// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createMaintenanceLaborDatabase} from './helpers/maintenanceLaborDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {maintenanceLaborContextSchema} from '@/lib/financial/maintenanceLaborAssociationContract';
import {financeAuditSchema} from '@/lib/financial/financeAuditContract';
let db:Awaited<ReturnType<typeof createMaintenanceLaborDatabase>>;const order=randomUUID(),supplier=randomUUID();
beforeAll(async()=>{db=await createMaintenanceLaborDatabase();
 await db.exec('create table finance_statement_imports(id uuid,tenant_id uuid,file_name text);create table finance_statement_rows(id uuid,tenant_id uuid,source_row integer)');
 for(const name of ['20260909233625_finance_audit_queries','20260910160441_finance_maintenance_cost_context','20260910161129_finance_maintenance_labor_context'])await db.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'));
},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("insert into maintenance_orders(id,tenant_id,order_number,status,labor_cost,supplier_vendor) values($1,$2,'OS QA','completed',50,'Nome informado na OS')",[order,i.tenant]);await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Oficina cadastrada',true)",[supplier,i.tenant]);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function read(page=1,search='',id=order){return maintenanceLaborContextSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select get_finance_maintenance_labor_context($1,$2,$3,$4) result',[i.tenant,id,page,search])).rows[0].result);}
async function costs(count=1){const items=Array.from({length:count},()=>({id:randomUUID(),category:'service',description:'Mão de obra registrada',amount_cents:5000,occurred_on:'2026-01-20',supplier_id:supplier,supplier_name:'Oficina cadastrada',no_receipt_reason:'Documento histórico sob conferência',payee_type:'supplier',allocations:[]}));
 await financeAs(db,i.operator,'select record_finance_expense_batch($1::jsonb)',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),context:'maintenance',description:'Serviços de manutenção',reason:'Conferência de mão de obra',items})]);return items;
}
it('paginates compatible-context costs and searches IDs and registered supplier literally',async()=>{
 const items=await costs(31);const first=await read(),last=await read(2);expect(first.total).toBe(31);expect(first.candidates).toHaveLength(30);expect(last.candidates).toHaveLength(1);
 expect(first.source.supplier_name).toBe('Nome informado na OS');expect(first.candidates[0].supplier_name).toBe('Oficina cadastrada');expect(first.candidates[0].supplier_id).toBe(supplier);
 expect((await read(1,items[0].id)).total).toBe(1);expect((await read(1,'Oficina cadastrada')).total).toBe(31);expect((await read(1,'%')).total).toBe(0);
});
it('returns permanent manual history and global audit after real association and reversal',async()=>{
 await costs();const candidate=(await read()).candidates[0];expect(candidate.issue).toBeNull();
 await financeAs(db,i.operator,'select associate_finance_maintenance_labor($1::jsonb)',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),order_id:order,cost_id:candidate.cost_id,revision:candidate.revision,reason:'Conferida a identidade do serviço da OS',same_labor_confirmed:true})]);
 const linked=await read(2,'sem resultado');expect(linked.total).toBe(0);expect(linked.active_link?.supplier_id).toBe(supplier);expect(linked.history.total).toBe(1);
 await financeAs(db,i.operator,'select reverse_finance_maintenance_labor_association($1::jsonb)',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),link_id:linked.active_link!.id,reason:'Desfeita a associação após conferência adicional'})]);
 const reversed=await read();expect(reversed.active_link).toBeNull();expect(reversed.history.rows[0].reversal?.actor_id).toBe(i.operator);
 const audit=financeAuditSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select list_finance_audit_events($1,$2::jsonb) result',[i.tenant,JSON.stringify({manual_only:true})])).rows[0].result);
 expect(audit.manual_count).toBe(2);expect(audit.rows.every(row=>row.manual_intervention&&row.actor_id===i.operator)).toBe(true);
});
it('exposes incompatible values instead of hiding them and rejects unauthorized context',async()=>{
 await costs();await db.query('update maintenance_orders set labor_cost=60 where id=$1',[order]);expect((await read()).candidates[0].issue).toBe('finance_maintenance_labor_source_mismatch');
 await expect(read(0)).rejects.toThrow('finance_invalid_filters');await expect(read(1,'',randomUUID())).rejects.toThrow('finance_maintenance_order_not_found');
 await expect(financeAs(db,i.driverUser,'select get_finance_maintenance_labor_context($1,$2)',[i.tenant,order])).rejects.toThrow('finance_access_denied');
});
