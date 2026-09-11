// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createMaintenanceDirectPartDatabase} from './helpers/maintenanceDirectPartDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {maintenanceDirectPartContextSchema} from '@/lib/financial/maintenanceDirectPartAssociationContract';
import {financeAuditSchema} from '@/lib/financial/financeAuditContract';
import {maintenanceLaborContextSchema} from '@/lib/financial/maintenanceLaborAssociationContract';
let db:Awaited<ReturnType<typeof createMaintenanceDirectPartDatabase>>;const order=randomUUID(),part=randomUUID(),supplier=randomUUID();
beforeAll(async()=>{db=await createMaintenanceDirectPartDatabase();await db.exec('create table finance_statement_imports(id uuid,tenant_id uuid,file_name text);create table finance_statement_rows(id uuid,tenant_id uuid,source_row integer)');
 for(const name of ['20260909233625_finance_audit_queries','20260910160441_finance_maintenance_cost_context','20260910161129_finance_maintenance_labor_context','20260910161828_finance_maintenance_direct_part_context'])await db.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'));
},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("insert into maintenance_orders(id,tenant_id,order_number,status,labor_cost,parts_cost,total_cost) values($1,$2,'OS QA','completed',0,50,50)",[order,i.tenant]);await db.query("insert into maintenance_parts(id,tenant_id,maintenance_order_id,item_description,quantity,unit_cost,total_cost) values($1,$2,$3,'Peças compradas',2,25,50)",[part,i.tenant,order]);await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Fornecedor de peças',true)",[supplier,i.tenant]);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function read(page=1,search='',id=part){return maintenanceDirectPartContextSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select get_finance_maintenance_direct_part_context($1,$2,$3,$4) result',[i.tenant,id,page,search])).rows[0].result);}
async function costs(count=1){const items=Array.from({length:count},()=>({id:randomUUID(),category:'maintenance',description:'Compra de peças',amount_cents:5000,occurred_on:'2026-01-20',supplier_id:supplier,supplier_name:'Fornecedor de peças',document_number:'NF 123',no_receipt_reason:'Documento sob conferência',payee_type:'supplier',allocations:[]}));
 await financeAs(db,i.operator,'select record_finance_expense_batch($1::jsonb)',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),context:'maintenance',description:'Peças de manutenção',reason:'Conferência da compra direta',items})]);return items;}
it('paginates real costs and exposes exact supplier/document/quantity for human review',async()=>{
 const items=await costs(31);const first=await read(),last=await read(2);expect(first.total).toBe(31);expect(first.candidates).toHaveLength(30);expect(last.candidates).toHaveLength(1);expect(first.source).toMatchObject({quantity:'2',unit_cost_cents:'2500',total_cost_cents:'5000'});
 expect(first.candidates[0]).toMatchObject({supplier_id:supplier,document_number:'NF 123'});expect((await read(1,items[0].id)).total).toBe(1);expect((await read(1,'NF 123')).total).toBe(31);expect((await read(1,'%')).total).toBe(0);
});
it('shows association and reversal in permanent history and manual audit',async()=>{
 await costs();const data=await read(),candidate=data.candidates[0];expect(candidate.issue).toBeNull();
 await financeAs(db,i.operator,'select associate_finance_maintenance_direct_part($1::jsonb)',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),part_id:part,cost_id:candidate.cost_id,revision:candidate.revision,classification:'direct_purchase',quantity:data.source.quantity,document_number:candidate.document_number,reason:'Conferida a compra direta da peça pelo documento',same_part_confirmed:true})]);
 const linked=await read(2,'ausente');expect(linked.active_link?.supplier_id).toBe(supplier);expect(linked.history.total).toBe(1);
 await financeAs(db,i.operator,'select reverse_finance_maintenance_direct_part_association($1::jsonb)',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),link_id:linked.active_link!.id,reason:'Desfeita após conferência do documento da peça'})]);
 const reversed=await read();expect(reversed.active_link).toBeNull();expect(reversed.history.rows[0].reversal?.actor_id).toBe(i.operator);
 const audit=financeAuditSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select list_finance_audit_events($1,$2::jsonb) result',[i.tenant,JSON.stringify({manual_only:true})])).rows[0].result);expect(audit.manual_count).toBe(2);
 expect(audit.rows.every(row=>row.manual_intervention&&row.actor_id===i.operator)).toBe(true);
});
it('rejects invalid context and keeps invalid quantity visible',async()=>{
 await costs();await db.query("update maintenance_parts set quantity='NaN' where id=$1",[part]);const data=await read();expect(data.source.quantity).toBeNull();expect(data.candidates[0].issue).toBeTruthy();
 await expect(read(0)).rejects.toThrow('finance_invalid_filters');await expect(read(1,'',randomUUID())).rejects.toThrow('finance_maintenance_part_not_found');await expect(financeAs(db,i.driverUser,'select get_finance_maintenance_direct_part_context($1,$2)',[i.tenant,part])).rejects.toThrow('finance_access_denied');
});
it('invalidates labor review and prevents offering a cost already claimed by a part',async()=>{
 await db.query('update maintenance_orders set labor_cost=50,total_cost=100 where id=$1',[order]);await costs();
 const labor=async()=>maintenanceLaborContextSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select get_finance_maintenance_labor_context($1,$2) result',[i.tenant,order])).rows[0].result);
 const before=(await labor()).candidates[0];expect(before.issue).toBeNull();const partContext=await read(),candidate=partContext.candidates[0];
 await financeAs(db,i.operator,'select associate_finance_maintenance_direct_part($1::jsonb)',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),part_id:part,cost_id:candidate.cost_id,revision:candidate.revision,classification:'direct_purchase',quantity:partContext.source.quantity,document_number:candidate.document_number,reason:'Compra direta comprovada no documento da peça',same_part_confirmed:true})]);
 const after=(await labor()).candidates[0];expect(after.issue).toBeTruthy();expect(after.revision).not.toBe(before.revision);
});
