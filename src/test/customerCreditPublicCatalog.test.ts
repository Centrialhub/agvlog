// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {customerCreditOptionsSchema,customerCreditPreviewSchema,customerCreditResultSchema} from '@/lib/financial/customerCreditContract';
import {createCustomerCreditApplicationDatabase,seedCustomerCreditApplicationSource} from './helpers/customerCreditApplicationDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
const candidate='supabase/migrations/20260911103921_finance_customer_credit_public_catalog.sql';
interface Page {revision:string;total:number;next_offset:number|null;rows:Array<Record<string,unknown>>;tenant_id:string;actor_id:string;can_execute:boolean}
async function setup(){const db=await createCustomerCreditApplicationDatabase();await db.exec(readFileSync('supabase/migrations/20260911101312_finance_customer_credit_applications.sql','utf8'));await db.exec(readFileSync(candidate,'utf8'));const source=await seedCustomerCreditApplicationSource(db);return{db,source};}
it('paginates all 35 eligible same-payer targets, detects drift, and applies/releases through authenticated public APIs',async()=>{
 const{db,source}=await setup();try{
  const ids:string[]=[];for(let n=0;n<35;n++){ids.push((await db.query<{id:string}>("insert into receivables(tenant_id,client_id,amount,received_amount,status,description) values($1,$2,50,0,'pending',$3) returning id",[i.tenant,source.payer,'Target '+String(n).padStart(2,'0')])).rows[0].id);}
  const foreignPayer=randomUUID();await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Other payer',true)",[foreignPayer,i.tenant]);await db.query("insert into receivables(tenant_id,client_id,amount,received_amount,status,description) values($1,$2,50,0,'pending','Not selectable')",[i.tenant,foreignPayer]);
  const options=async(query:Record<string,unknown>)=>customerCreditOptionsSchema.parse((await operationRpc<{v:Page}>(db,'select get_finance_customer_credit_options($1,$2) v',[i.tenant,{credit_id:null,payer_id:null,search:'',available_only:false,offset:0,limit:30,expected_revision:null,...query}])).rows[0].v);
  const credits=await options({kind:'credits'});expect(credits).toMatchObject({tenant_id:i.tenant,actor_id:i.operator,total:1,can_execute:false});expect(credits.rows[0]).toMatchObject({credit_id:source.credit,available_cents:'10000',valid:true});expect(JSON.stringify(credits)).not.toContain('source_snapshot');
  const first=await options({kind:'targets',credit_id:source.credit});expect(first.total).toBe(35);expect(first.rows).toHaveLength(30);expect(first.next_offset).toBe(30);
  const second=await options({kind:'targets',credit_id:source.credit,offset:30,expected_revision:first.revision});expect(second.rows).toHaveLength(5);expect(second.next_offset).toBe(null);expect(second.revision).toBe(first.revision);if(first.kind!=='targets'||second.kind!=='targets')throw Error('Wrong page kind');expect(new Set([...first.rows,...second.rows].map(x=>x.receivable_id)).size).toBe(35);
  const preview=async(application:string|null=null)=>customerCreditPreviewSchema.parse((await operationRpc<{v:{revision:string;eligible:boolean;can_execute:boolean;credit:Record<string,unknown>}}>(db,'select preview_finance_customer_credit_application($1,$2,$3,$4,$5) v',[i.tenant,source.credit,ids[0],'4000',application])).rows[0].v);
  const ctx=await preview();expect(ctx).toMatchObject({eligible:true,can_execute:true});expect(ctx.credit).not.toHaveProperty('history');expect(ctx).not.toHaveProperty('_evidence');
  const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),credit_id:source.credit,receivable_id:ids[0],application_id:null,action:'apply',amount_cents:'4000',expected_revision:ctx.revision,reason:'Apply existing credit through public command'};
  const write=async(p:unknown)=>customerCreditResultSchema.parse((await operationRpc<{v:{application_id:string}}>(db,'select record_finance_customer_credit_application($1) v',[p])).rows[0].v);
  const result=await write(payload);expect(await write(payload)).toEqual(result);
  await expect(options({kind:'targets',credit_id:source.credit,offset:30,expected_revision:first.revision})).rejects.toMatchObject({code:'40001'});
  const history=await options({kind:'history',credit_id:source.credit});expect(history.total).toBe(1);expect(history.rows[0]).toMatchObject({action:'apply',remaining_cents:'4000',can_release:true});expect(JSON.stringify(history)).not.toContain('source_snapshot');
  const release=await preview(result.application_id);expect(release.can_execute).toBe(true);await write({...payload,request_id:randomUUID(),application_id:result.application_id,action:'release',expected_revision:release.revision});
  expect((await options({kind:'credits'})).rows[0]).toMatchObject({available_cents:'10000',applied_cents:'0'});const releasedHistory=await options({kind:'history',credit_id:source.credit});if(releasedHistory.kind!=='history')throw Error('Wrong history kind');expect(releasedHistory.rows.find(x=>x.action==='apply')).toMatchObject({remaining_cents:'0',can_release:false});
  expect((await db.query<{n:number}>('select count(*)::int n from bank_transactions')).rows[0].n).toBe(1);await db.exec('set constraints all immediate');
 }finally{await db.close();}
},30000);
it('denies anonymous/raw/cross-tenant/mixed and revoked actors without disclosing catalog',async()=>{
 const{db,source}=await setup();try{
  const catalog=(tenant=i.tenant)=>(operationRpc(db,'select get_finance_customer_credit_options($1,$2)',[tenant,{kind:'credits'}]));
  for(const sig of ['finance_private.customer_credit_position(uuid,uuid)','finance_private.record_customer_credit_application(jsonb)','finance_private.customer_credit_application_context(uuid,uuid,uuid,text,uuid)'])expect((await db.query<{v:boolean}>("select has_function_privilege('authenticated',$1,'execute') v",[sig])).rows[0].v).toBe(false);
  await db.exec('savepoint anonymous;set role anon');await expect(db.query('select get_finance_customer_credit_options($1,$2)',[i.tenant,{kind:'credits'}])).rejects.toMatchObject({code:'42501'});await db.exec('rollback to anonymous;reset role');
  await expect(catalog(i.otherTenant)).rejects.toMatchObject({code:'42501'});
  await db.query("insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'driver',true)",[i.tenant,i.operator]);await expect(catalog()).rejects.toMatchObject({code:'42501'});await db.query("delete from tenant_memberships where tenant_id=$1 and user_id=$2 and role='driver'",[i.tenant,i.operator]);
  await db.query('update tenant_memberships set active=false where tenant_id=$1 and user_id=$2',[i.tenant,i.operator]);await expect(catalog()).rejects.toMatchObject({code:'42501'});
  expect((await db.query<{n:number}>('select count(*)::int n from finance_private.customer_credit_application_events where credit_id=$1',[source.credit])).rows[0].n).toBe(0);
 }finally{await db.close();}
},30000);

it('refuses a same-name guard with a false predicate or wrong event before exposing commands',async()=>{
 const{db}=await setup();try{
  for(const shape of ['before delete','before insert']){
   await db.exec('savepoint changed_guard;drop trigger guard_customer_credit_application_insert on finance_private.customer_credit_application_events');
   await db.exec('create trigger guard_customer_credit_application_insert '+shape+' on finance_private.customer_credit_application_events for each row when(false) execute function finance_private.guard_customer_credit_application_insert()');
   await expect(db.exec(readFileSync(candidate,'utf8'))).rejects.toMatchObject({code:'55000'});await db.exec('rollback to changed_guard');
  }
 }finally{await db.close();}
},30000);
