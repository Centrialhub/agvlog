// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createFinanceLedgerDatabase,financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {movementListSchema} from '@/lib/financial/ledgerContract';
let db:Awaited<ReturnType<typeof createFinanceLedgerDatabase>>;
beforeAll(async()=>{db=await createFinanceLedgerDatabase();for(const name of ['20260910182541_finance_movement_correction_foundation','20260910182830_finance_movement_correction_history'])await db.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function record(direction:'in'|'out',description='Registro histórico'){
 const request=randomUUID();const result=(await financeAs<{v:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1) v',[{version:1,tenant_id:i.tenant,request_id:request,bank_account_id:i.account,direction,nature:'other',amount_cents:50000,occurred_on:'2026-08-15',description,beneficiary_name:'Favorecido QA',reason:'Registro para teste do histórico'}])).rows[0].v;
 return {id:result.movement_id,request};
}
async function injectVoid(source:{id:string;request:string}){
 // No public write command exists at this stage. Owner fixture exercises the reader only.
 const request=randomUUID();await db.query("insert into finance_commands(tenant_id,request_id,actor_id,action,payload,result) values($1,$2,$3,'qa_storage_only','{}','{}')",[i.tenant,request,i.operator]);
 await db.query(`insert into finance_movement_voids(tenant_id,movement_id,original_request_id,request_id,kind,actor_id,actor_name,reason,revision,source_snapshot)
 values($1,$2,$3,$4,'void',$5,'Financeiro QA','Erro de registro conferido',md5('reader QA'),' {"fixture":"owner storage only"}'::jsonb)`,[i.tenant,source.id,source.request,request,i.operator]);
}
async function list(filters:Record<string,unknown>={},actor=i.operator,tenant=i.tenant){return movementListSchema.parse((await financeAs<{v:unknown}>(db,actor,'select list_finance_movements($1,$2) v',[tenant,{page:1,page_size:30,...filters}])).rows[0].v);}
it('separates active and historical totals across pages while retaining the original row and manual actor',async()=>{
 for(let n=0;n<31;n++)await record('out');
 const invalid=await record('out','Erro selecionável');await injectVoid(invalid);
 const incoming=await record('in');await injectVoid(incoming);
 const first=await list(),second=await list({page:2});
 const totals={total:33,active_count:31,voided_count:2,inflow_cents:'0',outflow_cents:'1550000',historical_inflow_cents:'50000',historical_outflow_cents:'1600000',voided_inflow_cents:'50000',voided_outflow_cents:'50000'};
 expect(first).toMatchObject(totals);expect(second).toMatchObject(totals);expect(first.rows).toHaveLength(30);expect(second.rows).toHaveLength(3);
 const row=first.rows.find(r=>r.id===invalid.id);expect(row).toMatchObject({amount_cents:50000,description:'Erro selecionável',voided:true,correction:{movement_id:invalid.id,original_request_id:invalid.request,actor_id:i.operator,actor_name:'Financeiro QA',reason:'Erro de registro conferido'}});
 expect(row?.correction).not.toHaveProperty('source_snapshot');
 expect((await db.query('select count(*)::int n from finance_movements')).rows[0]).toEqual({n:33});
});
it('retains an entirely voided filtered history with zero active totals and preserves ordinary active rows',async()=>{
 const invalid=await record('out','Erro selecionável');await injectVoid(invalid);await record('out','Ativo válido');
 expect(await list({search:'Erro selecionável'})).toMatchObject({total:1,active_count:0,voided_count:1,outflow_cents:'0',historical_outflow_cents:'50000',voided_outflow_cents:'50000'});
 const active=await list({search:'Ativo válido'});expect(active).toMatchObject({total:1,active_count:1,voided_count:0,outflow_cents:'50000'});expect(active.rows[0]).toMatchObject({voided:false,correction:null});
});
it('denies foreign-tenant and driver access including mixed administrative membership',async()=>{
 await record('out');await expect(list({},i.operator,i.otherTenant)).rejects.toThrow('finance_access_denied');await expect(list({},i.driverUser)).rejects.toThrow('finance_access_denied');
 await db.query("update tenant_memberships set role='admin' where user_id=$1",[i.driverUser]);await expect(list({},i.driverUser)).rejects.toThrow('finance_access_denied');
});
