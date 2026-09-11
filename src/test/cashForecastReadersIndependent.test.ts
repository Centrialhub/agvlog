// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createCashForecastCollectorDatabase} from './helpers/cashForecastCollectorDatabase';
import {financeIds as i} from './helpers/financeLedgerDatabase';
let db:Awaited<ReturnType<typeof createCashForecastCollectorDatabase>>;
beforeAll(async()=>{db=await createCashForecastCollectorDatabase();for(const name of ['20260911084618_finance_cash_forecast_pure_projection','20260911084626_finance_cash_forecast_preserved_snapshots','20260911085621_finance_cash_forecast_public_readers'])await db.exec(readFileSync('supabase/migrations/'+name+'.sql','utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');await actor(i.operator);});afterEach(async()=>db.exec('rollback'));afterAll(async()=>db?.close());
async function actor(id:string){await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);}
async function seed(){const client=randomUUID();await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Carteira QA',true)",[client,i.tenant]);await db.query("insert into receivables(tenant_id,client_id,amount,received_amount,status,due_date,description) select $1,$2,10,0,'pending',current_date+10,'Título independente' from generate_series(1,32)",[i.tenant,client]);const collection=(await db.query<{v:{revision:string,cutoff:string,period_end:string,origins:Array<{source_id:string}>}}>("select finance_private.cash_forecast_collect($1,'2026-08-31',current_date+30) v",[i.tenant])).rows[0].v;const saved=(await db.query<{v:{snapshot_id:string}}>('select finance_private.record_cash_forecast_snapshot($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),cutoff:collection.cutoff,period_end:collection.period_end,source_revision:collection.revision,title:'Captura original',reason:'Revisão independente dos leitores'}])).rows[0].v;return{collection,saved};}
async function page(scope:Awaited<ReturnType<typeof seed>>,snapshot:string|null,page=2,tenant=i.tenant){return(await db.query<{v:{actor_id:string,revision:string,total:number,rows:Array<{source_id:string}>}}>('select finance_private.cash_forecast_source_page($1,$2,$3,$4,$5,$6,$7) v',[tenant,scope.collection.cutoff,scope.collection.period_end,snapshot,'origins',page,scope.collection.revision])).rows[0].v;}
it('separates historical author from current viewer and binds every source page to its original revision',async()=>{
 const scope=await seed();const second=randomUUID();await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'second@example.test','{}')",[second]);await db.query("insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'operator',true)",[i.tenant,second]);
 const first=await page(scope,scope.saved.snapshot_id,1),last=await page(scope,scope.saved.snapshot_id);expect(first.rows).toHaveLength(30);expect(last.rows).toHaveLength(2);expect(new Set([...first.rows,...last.rows].map(x=>x.source_id)).size).toBe(32);
 await actor(second);const viewed=await page(scope,scope.saved.snapshot_id);expect(viewed.actor_id).toBe(second);expect(viewed.rows).toEqual(last.rows);
 const summary=(await db.query<{v:{actor_id:string,viewer_actor_id:string,summary:{actor_id:string}}}>('select finance_private.cash_forecast_snapshot_summary($1,$2) v',[i.tenant,scope.saved.snapshot_id])).rows[0].v;expect(summary.actor_id).toBe(i.operator);expect(summary.summary.actor_id).toBe(i.operator);expect(summary.viewer_actor_id).toBe(second);
 await db.exec('savepoint stale_actor');await expect(page(scope,null)).rejects.toMatchObject({code:'40001'});await db.exec('rollback to stale_actor');
 await actor(i.operator);await db.query('update receivables set amount=99 where id=$1',[scope.collection.origins[0].source_id]);await db.exec('savepoint stale_source');await expect(page(scope,null)).rejects.toMatchObject({code:'40001'});await db.exec('rollback to stale_source');expect((await page(scope,scope.saved.snapshot_id)).rows).toEqual(last.rows);
});
it('denies foreign, mismatched-period and newly mixed-driver reads without exposing the captured sources',async()=>{
 const scope=await seed();await db.exec('savepoint foreign_scope');await expect(page(scope,scope.saved.snapshot_id,1,i.otherTenant)).rejects.toMatchObject({code:'42501'});await db.exec('rollback to foreign_scope');
 await db.exec('savepoint wrong_period');await expect(db.query('select finance_private.cash_forecast_source_page($1,$2,$3,$4,$5,1,$6)',[i.tenant,'2026-08-30',scope.collection.period_end,scope.saved.snapshot_id,'origins',scope.collection.revision])).rejects.toMatchObject({code:'22023'});await db.exec('rollback to wrong_period');
 await db.query('insert into drivers(id,tenant_id,user_id,active) values($1,$2,$3,true)',[randomUUID(),i.tenant,i.operator]);await expect(page(scope,scope.saved.snapshot_id)).rejects.toMatchObject({code:'42501'});
});
