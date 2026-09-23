// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {createFinanceAuditDatabase} from './helpers/financeAuditRemediationDatabase';
import {financeIds as i} from './helpers/financeLedgerDatabase';
let db:Awaited<ReturnType<typeof createFinanceAuditDatabase>>;
beforeAll(async()=>{db=await createFinanceAuditDatabase();},30000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:i.operator,role:'authenticated',active_tenant_id:i.tenant})]);await db.query('insert into tenants(id) values($1),($2)',[i.tenant,i.otherTenant]);await db.query("insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'admin',true)",[i.tenant,i.operator]);});
afterEach(async()=>{await db.exec('rollback');});
async function save(command:Record<string,unknown>){await db.exec('savepoint command;set role authenticated');try{const r=await db.query<{v:{record:Record<string,unknown>}}>('select save_finance_manual_title($1) v',[command]);await db.exec('reset role;release savepoint command');return r.rows[0].v;}catch(e){await db.exec('rollback to savepoint command;release savepoint command');throw e;}}
const create=(kind='payable')=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),kind,id:null as string|null,expected_updated_at:null as string|null,fields:kind==='payable'?{supplier_name:'Fornecedor QA',category:'supplier',amount:100,status:'pending',document_number:'NF-10'}:{description:'Frete QA',amount:100,status:'pending',invoice_number:'NF-10'},duplicate_reason:''});
it.each(['payable','receivable'])('creates one %s for a replayed request and warns about a different similar request',async kind=>{
 const c=create(kind),first=await save(c);expect(await save(c)).toEqual(first);
 await expect(save({...c,request_id:randomUUID()})).rejects.toThrow('finance_possible_duplicate');
 await save({...c,request_id:randomUUID(),duplicate_reason:'Segunda parcela legítima conferida'});
 expect((await db.query(`select count(*)::int n from ${kind==='payable'?'payables':'receivables'}`)).rows[0]).toEqual({n:2});
});
it('rejects a concurrent receivable edit without replacing the first change',async()=>{
 const c=create('receivable'),first=(await save(c)).record;
 const edit={...c,request_id:randomUUID(),id:first.id,expected_updated_at:first.updated_at,fields:{description:'Primeira edição'}};
 await save(edit);await expect(save({...edit,request_id:randomUUID(),fields:{description:'Edição desatualizada'}})).rejects.toThrow('finance_manual_title_changed');
 expect((await db.query('select description from receivables where id=$1',[first.id])).rows[0]).toEqual({description:'Primeira edição'});
});
it('keeps operator payable access and denies receivable creation plus another tenant',async()=>{
 await db.query("update tenant_memberships set role='operator'");await save(create());
 await expect(save(create('receivable'))).rejects.toThrow('finance_access_denied');
 await expect(save({...create(),tenant_id:i.otherTenant})).rejects.toThrow('finance_access_denied');
});
it('does not create a title when writing its acknowledgement fails',async()=>{
 await db.exec("create function qa_fail_command() returns trigger language plpgsql as $$begin raise exception 'qa failure';end$$; create trigger qa_fail before insert on finance_commands for each row execute function qa_fail_command()");
 await expect(save(create())).rejects.toThrow('qa failure');expect((await db.query('select count(*)::int n from payables')).rows[0]).toEqual({n:0});
});
it('requires the dedicated approval command instead of promoting a manual edit',async()=>{
 const c=create(),first=(await save(c)).record;
 await expect(save({...c,request_id:randomUUID(),id:first.id,expected_updated_at:first.updated_at,fields:{status:'approved'}})).rejects.toThrow('finance_payable_approval_revision_required');
 expect((await db.query('select status,source from payables where id=$1',[first.id])).rows[0]).toEqual({status:'pending',source:'manual'});
});
