// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {createFinanceAuditDatabase} from './helpers/financeAuditRemediationDatabase';
import {financeIds as i} from './helpers/financeLedgerDatabase';
import {fiscalWorkQueueSchema} from '@/lib/financial/fiscalQueueContract';
let db:Awaited<ReturnType<typeof createFinanceAuditDatabase>>;
beforeAll(async()=>{db=await createFinanceAuditDatabase();},30000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:i.operator,role:'authenticated',active_tenant_id:i.tenant})]);await db.query('insert into tenants(id) values($1)',[i.tenant]);await db.query("insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'operator',true)",[i.tenant,i.operator]);});
afterEach(async()=>{await db.exec('rollback');});
async function observation(emission:string,order:number){const id=randomUUID();await db.query("insert into finance_fiscal_observations(id,tenant_id,emission_id,observed_order,snapshot,snapshot_hash) values($1,$2,$3,$4,$5,'qa')",[id,i.tenant,emission,order,{doc_type:'cte',number:'123',status:'authorized',cte_document_id:randomUUID()}]);await db.query("insert into finance_fiscal_projection_jobs(observation_id,tenant_id,status) values($1,$2,'review')",[id,i.tenant]);return id;}
async function queue(current=true){return fiscalWorkQueueSchema.parse((await db.query<{v:unknown}>("select list_finance_fiscal_work_queue($1,'review',null,null,$2) v",[i.tenant,current])).rows[0].v);}
async function assign(payload:unknown){await db.exec('savepoint command');try{const result=(await db.query<{v:unknown}>('select assign_finance_fiscal_review($1) v',[payload])).rows[0].v;await db.exec('release savepoint command');return result;}catch(error){await db.exec('rollback to savepoint command;release savepoint command');throw error;}}
it('counts latest documents separately from historical observations and preserves assignments with idempotency and revision checks',async()=>{
 const emission=randomUUID();await db.query('insert into hub_fiscal_emissions(id,tenant_id) values($1,$2)',[emission,i.tenant]);
 const old=await observation(emission,1),latest=await observation(emission,2);
 const current=await queue();expect(current.total).toBe(1);expect(current.counts.review).toBe(1);expect(current.rows[0].observation_id).toBe(latest);expect((await queue(false)).total).toBe(2);
 const command={version:1,tenant_id:i.tenant,request_id:randomUUID(),observation_id:latest,revision:current.rows[0].assignment_revision,due_on:'2026-09-30',note:'Conferir protocolo na origem'};
 const first=await assign(command);expect(await assign(command)).toEqual(first);
 expect((await queue()).rows[0].assignment).toMatchObject({actor_id:i.operator,due_on:'2026-09-30',note:command.note});
 await expect(assign({...command,request_id:randomUUID(),note:'Outra revisão concorrente'})).rejects.toThrow('finance_fiscal_review_changed');
 await expect(assign({...command,request_id:randomUUID(),observation_id:old})).rejects.toThrow('finance_fiscal_review_changed');
 expect((await db.query('select count(*)::int n from finance_private.fiscal_review_assignments')).rows[0]).toEqual({n:1});
});
