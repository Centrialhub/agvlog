// @vitest-environment node
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {createCashForecastCollectorDatabase} from './helpers/cashForecastCollectorDatabase';
import {financeIds as i,financeAs} from './helpers/financeLedgerDatabase';
import {seedAccountCloseStatement} from './helpers/accountPeriodCloseDatabase';
import {cashForecastCollectorSchema} from '@/lib/financial/cashForecastCollectorContract';
import {projectCollectedCashForecast} from '@/lib/financial/cashForecastCollectorProjection';
let db:Awaited<ReturnType<typeof createCashForecastCollectorDatabase>>;
const migration=(n:string)=>readFileSync('supabase/migrations/'+n+'.sql','utf8');
beforeAll(async()=>{db=await createCashForecastCollectorDatabase();await db.exec(migration('20260911084618_finance_cash_forecast_pure_projection'));await db.exec(migration('20260911084626_finance_cash_forecast_preserved_snapshots'));await db.exec(migration('20260911085621_finance_cash_forecast_public_readers'));},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);});
afterEach(async()=>db.exec('rollback'));afterAll(async()=>{if(db&&process.env.CAPTURE_FORECAST_CATALOG==='1'){const catalog=await db.query("select p.oid::regprocedure::text signature,md5(replace(p.prosrc,E'\\r\\n',E'\\n')) body_md5,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='finance_private' and p.proname in ('cash_forecast_collect','forecast_movement_evidence','forecast_customer_credit_evidence','validate_forecast_json','project_collected_cash_forecast','read_cash_forecast_snapshot','record_cash_forecast_snapshot','list_cash_forecast_snapshots','cash_forecast_summary','preview_cash_forecast','cash_forecast_source_page','cash_forecast_snapshot_summary') order by 1");writeFileSync('docs/qa/finance-cash-forecast-public-dependencies-2026-09-11.json',JSON.stringify(catalog.rows,null,2)+'\n','utf8');}await db?.close();});
async function collect(){return cashForecastCollectorSchema.parse((await db.query<{v:unknown}>("select finance_private.cash_forecast_collect($1,'2026-08-31',current_date+30) v",[i.tenant])).rows[0].v);}
async function seed(){
 await seedAccountCloseStatement(db,'2026-08-31',10000,'2026-09-01','2026-09-30');await seedAccountCloseStatement(db,'2026-09-30',10000,'2026-09-01','2026-09-30');
 const ev=(await financeAs<{v:{revision:string}}>(db,i.operator,'select get_finance_statement_period_evidence($1,$2,$3,$4) v',[i.tenant,i.account,'2026-09-01','2026-09-30'])).rows[0].v;
 await financeAs(db,i.operator,'select record_finance_account_opening($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Opening from real statement',account_id:i.account,from:'2026-09-01',to:'2026-09-30',revision:ev.revision}]);
 const client=randomUUID();await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Forecast QA',true)",[client,i.tenant]);
 return (await db.query<{id:string}>("insert into receivables(tenant_id,client_id,amount,received_amount,status,due_date,description) values($1,$2,150,0,'pending',current_date+10,'Expected receipt') returning id",[i.tenant,client])).rows[0].id;
}
async function payload(){const c=await collect();return {version:1,tenant_id:i.tenant,request_id:randomUUID(),cutoff:c.cutoff,period_end:c.period_end,source_revision:c.revision,title:'Previsao original',reason:'Preservar expectativa conferida'};}
async function write(p:Awaited<ReturnType<typeof payload>>){return(await db.query<{v:{snapshot_id:string;content_hash:string}}>('select finance_private.record_cash_forecast_snapshot($1) v',[p])).rows[0].v;}
async function read(id:string){return(await db.query<{v:Record<string,unknown>}>('select finance_private.read_cash_forecast_snapshot($1,$2) v',[i.tenant,id])).rows[0].v;}
it('preserves the original server projection and replays exactly after the live obligation changes',async()=>{
 const title=await seed();const c=await collect();const expected=projectCollectedCashForecast(c,c);const p=await payload();const saved=await write(p);const original=await read(saved.snapshot_id);
 expect(original.projection).toMatchObject({confirmed:expected.projection!.confirmed});expect(original.collection).toMatchObject({revision:p.source_revision});
 await db.query('update receivables set amount=250 where id=$1',[title]);expect((await collect()).revision).not.toBe(p.source_revision);expect(await write(p)).toEqual(saved);expect(await read(saved.snapshot_id)).toEqual(original);
 expect((await db.query('select count(*)::int n from finance_private.cash_forecast_snapshots')).rows).toEqual([{n:1}]);
});
it('rejects a stale preview before inserting the snapshot',async()=>{
 const title=await seed();const p=await payload();await db.query('update receivables set amount=250 where id=$1',[title]);await db.exec('savepoint stale');await expect(write(p)).rejects.toMatchObject({code:'40001'});await db.exec('rollback to stale');expect((await db.query('select count(*)::int n from finance_private.cash_forecast_snapshots')).rows).toEqual([{n:0}]);
});
it('rolls back the snapshot if final audit recording fails',async()=>{
 await seed();const p=await payload();await db.exec("create function pg_temp.reject_forecast_audit() returns trigger language plpgsql as $$begin if new.action='cash_forecast_preserved' then raise exception 'injected audit failure';end if;return new;end$$;create trigger reject_forecast_audit before insert on finance_events for each row execute function pg_temp.reject_forecast_audit()");
 await db.exec('savepoint failed_audit');await expect(write(p)).rejects.toThrow('injected audit failure');await db.exec('rollback to failed_audit');expect((await db.query('select count(*)::int n from finance_private.cash_forecast_snapshots')).rows).toEqual([{n:0}]);expect((await db.query('select count(*)::int n from finance_commands where request_id=$1',[p.request_id])).rows).toEqual([{n:0}]);
});
it('denies revoked replay, cross-company reads and raw authenticated access',async()=>{
 await seed();const p=await payload();const saved=await write(p);
 await expect(financeAs(db,i.operator,'select * from finance_private.cash_forecast_snapshots',[])).rejects.toMatchObject({code:'42501'});
 await db.exec('savepoint foreign_scope');await expect(db.query('select finance_private.read_cash_forecast_snapshot($1,$2)',[i.otherTenant,saved.snapshot_id])).rejects.toMatchObject({code:'42501'});await db.exec('rollback to foreign_scope');
 await db.query('update tenant_memberships set active=false where tenant_id=$1 and user_id=$2',[i.tenant,i.operator]);await expect(write(p)).rejects.toMatchObject({code:'42501'});
});
it('keeps immutable captures and refuses reusing a request for different content',async()=>{
 await seed();const p=await payload();const s=await write(p);await db.exec('savepoint immutable');await expect(db.query("update finance_private.cash_forecast_snapshots set title='Changed' where id=$1",[s.snapshot_id])).rejects.toMatchObject({code:'55000'});await db.exec('rollback to immutable');await expect(write({...p,title:'Different content'})).rejects.toMatchObject({code:'23505'});
});


it('pages complete immutable history and refuses continuing with an obsolete catalogue revision',async()=>{
 await seed();const p=await payload();
 await db.query("do $capture$ declare n integer;payload jsonb:='"+JSON.stringify(p).replace(/'/g,"''")+"'::jsonb;begin for n in 1..31 loop perform finance_private.record_cash_forecast_snapshot(payload||jsonb_build_object('request_id',gen_random_uuid(),'title','Capture '||n));end loop;end$capture$");
 type Page={total:number;revision:string;rows:Array<{snapshot_id:string;title:string}>};
 const list=async(page:number,revision:string|null)=>(await db.query<{v:Page}>('select finance_private.list_cash_forecast_snapshots($1,$2,$3) v',[i.tenant,page,revision])).rows[0].v;
 await db.exec('savepoint missing_revision');await expect(list(2,null)).rejects.toMatchObject({code:'22023'});await db.exec('rollback to missing_revision');
 const first=await list(1,null),second=await list(2,first.revision);expect(first.total).toBe(31);expect(first.rows).toHaveLength(30);expect(second.rows).toHaveLength(1);expect(new Set([...first.rows,...second.rows].map(r=>r.snapshot_id)).size).toBe(31);
 await write({...p,request_id:randomUUID()});await expect(list(2,first.revision)).rejects.toMatchObject({code:'40001'});
},30000);


it('serves compact summaries and revision-bound live or preserved source pages',async()=>{
 const title=await seed();await db.query("insert into receivables(tenant_id,client_id,amount,received_amount,status,due_date,description) select r.tenant_id,r.client_id,10,0,'pending',current_date+10,'Additional title' from receivables r cross join generate_series(1,64) g where r.id=$1",[title]);
 const p=await payload();const c=await collect();const saved=await write(p);
 const summary=(await db.query<{v:Record<string,unknown>}>('select finance_private.preview_cash_forecast($1,$2,$3,$4) v',[i.tenant,p.cutoff,p.period_end,p.source_revision])).rows[0].v;
 expect(summary).not.toHaveProperty('origins');expect(summary).not.toHaveProperty('rows');expect(summary).toHaveProperty('counts');
 const page=async(snapshot:string|null,revision:string)=>(await db.query<{v:{rows:unknown[];total:number}}> ('select finance_private.cash_forecast_source_page($1,$2,$3,$4,$5,1,$6) v',[i.tenant,p.cutoff,p.period_end,snapshot,'origins',revision])).rows[0].v;
 expect((await page(null,p.source_revision)).rows).toEqual(c.origins.slice(0,30));
 const third=(await db.query<{v:{rows:unknown[];total:number}}>('select finance_private.cash_forecast_source_page($1,$2,$3,null,$4,3,$5) v',[i.tenant,p.cutoff,p.period_end,'origins',p.source_revision])).rows[0].v;expect(third.total).toBe(65);expect(third.rows).toEqual(c.origins.slice(60));
 await db.query('update receivables set amount=175 where id=$1',[title]);await db.exec('savepoint stale_page');await expect(page(null,p.source_revision)).rejects.toMatchObject({code:'40001'});await db.exec('rollback to stale_page');
 expect((await page(saved.snapshot_id,p.source_revision)).rows).toEqual(c.origins.slice(0,30));
 const historical=(await db.query<{v:Record<string,unknown>}>('select finance_private.cash_forecast_snapshot_summary($1,$2) v',[i.tenant,saved.snapshot_id])).rows[0].v;
 expect(historical.viewer_actor_id).toBe(i.operator);expect(historical).not.toHaveProperty('collection');expect(historical).toHaveProperty('summary');
});
