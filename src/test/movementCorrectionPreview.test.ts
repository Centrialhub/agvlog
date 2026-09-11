// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createMovementCorrectionContextDatabase} from './helpers/movementCorrectionContextDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {movementCorrectionPreviewSchema} from '@/lib/financial/movementCorrectionPreviewContract';
let db:Awaited<ReturnType<typeof createMovementCorrectionContextDatabase>>;
beforeAll(async()=>{db=await createMovementCorrectionContextDatabase();await db.exec(readFileSync('supabase/migrations/20260910190635_finance_movement_correction_preview.sql','utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function money(direction:'in'|'out'='out'){const request=randomUUID();const result=(await financeAs<{v:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1) v',[{version:1,tenant_id:i.tenant,request_id:request,bank_account_id:i.account,direction,nature:'other',amount_cents:5000,occurred_on:'2026-01-20',description:'Registro manual em revisão',beneficiary_name:'Favorecido QA',reason:'Registro original conferido'}])).rows[0].v;return{id:result.movement_id,request};}
async function preview(id:string,actor=i.operator,tenant=i.tenant){return movementCorrectionPreviewSchema.parse((await financeAs<{v:unknown}>(db,actor,'select preview_finance_movement_correction($1,$2) v',[tenant,id])).rows[0].v);}
it('returns a real origin and prospective signed effects without granting execution or changing money',async()=>{
 const m=await money(),v=await preview(m.id);
 expect(v).toMatchObject({operation:'void',movement_id:m.id,can_execute:false,eligible:true,origin:{verified:true,original_request_id:m.request},effects:{computation:'prospective_invalidation',bank_money_transacted:false,recorded_balance_changed:true,inflow_delta_cents:'0',outflow_delta_cents:'-5000',balance_delta_cents:'5000'}});
 expect(await preview(m.id)).toEqual(v);expect((await db.query('select count(*)::int n from finance_movements')).rows[0]).toEqual({n:1});expect((await db.query('select count(*)::int n from finance_movement_voids')).rows[0]).toEqual({n:0});
 const incoming=await money('in');expect((await preview(incoming.id)).effects).toMatchObject({inflow_delta_cents:'-5000',outflow_delta_cents:'0',balance_delta_cents:'-5000'});
});
it('exposes the actual payment dependency and changes revision while preserving the paid obligation',async()=>{
 const m=await money(),before=await preview(m.id);
 const title=(await db.query<{id:string}>("insert into payables(tenant_id,supplier_name,category,amount,status) values($1,'Fornecedor QA','other',50,'approved') returning id",[i.tenant])).rows[0].id;
 await financeAs(db,i.operator,'select apply_finance_payable_movement($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),payable_id:title,movement_id:m.id,amount_cents:5000,method:'pix',reason:'Registro de baixa pelo movimento existente'}]);
 const after=await preview(m.id);expect(after.eligible).toBe(false);expect(after.can_execute).toBe(false);expect(after.revision).not.toBe(before.revision);expect(after.blockers.length).toBeGreaterThan(0);
 expect(after.dependencies.finance_payable_movement_links).toEqual(expect.arrayContaining([expect.objectContaining({movement_id:m.id,payable_id:title})]));
 expect((await db.query('select count(*)::int n from payables_payments')).rows[0]).toEqual({n:1});
});
it('retains a prior correction as history with no second prospective money change',async()=>{
 const m=await money(),request=randomUUID();
 // Existing historical state only; there is no public correction command yet.
 await db.query("insert into finance_commands(tenant_id,request_id,actor_id,action,payload,result) values($1,$2,$3,'qa_storage_only','{}','{}')",[i.tenant,request,i.operator]);
 await db.query(`insert into finance_movement_voids(tenant_id,movement_id,original_request_id,request_id,kind,actor_id,actor_name,reason,revision,source_snapshot)
 values($1,$2,$3,$4,'void',$5,'Financeiro QA','Correção histórica conferida',md5('preview QA'),'{"fixture":"owner only"}')`,[i.tenant,m.id,m.request,request,i.operator]);
 expect(await preview(m.id)).toMatchObject({eligible:false,can_execute:false,effects:null,void:{movement_id:m.id,actor_id:i.operator,reason:'Correção histórica conferida'}});
});
it('rejects nonexistent origins, another tenant and mixed-driver access before exposing the context',async()=>{
 const m=await money();await expect(preview(randomUUID())).rejects.toThrow('finance_movement_not_found');await expect(preview(m.id,i.operator,i.otherTenant)).rejects.toThrow('finance_access_denied');
 await db.query("insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'driver',true)",[i.tenant,i.operator]);await expect(preview(m.id)).rejects.toThrow('finance_access_denied');
});
