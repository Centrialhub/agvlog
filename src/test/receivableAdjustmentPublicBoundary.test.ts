// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {createReceivableBalanceAdjustmentReviewDatabase,balanceAdjustmentReviewIds as i} from './helpers/receivableBalanceAdjustmentReviewDatabase';
import {receivableAdjustmentPreviewSchema,receivableAdjustmentHistorySchema,parseReceivableAdjustmentResult} from '@/lib/financial/receivableAdjustmentContract';
import {receivableAdjustmentCommandSchema} from '@/lib/financial/receivableAdjustmentCommandContract';
it('exposes only audited adjustment entrypoints and preserves exact public DTO, replay and history',async()=>{
 const db=await createReceivableBalanceAdjustmentReviewDatabase();try{
 await db.exec(readFileSync('supabase/migrations/20260911115046_finance_receivable_balance_adjustments.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260911121356_finance_receivable_adjustment_public_catalog.sql','utf8'));
 const permissions=(await db.query<{name:string,a:boolean,n:boolean,s:boolean}>("select proname name,has_function_privilege('authenticated',oid,'execute') a,has_function_privilege('anon',oid,'execute') n,has_function_privilege('service_role',oid,'execute') s from pg_proc where proname in ('record_finance_receivable_adjustment','preview_finance_receivable_adjustment','get_finance_receivable_adjustments','record_receivable_balance_adjustment','receivable_balance_adjustment_context','receivable_balance_adjustment_history')")).rows;
 expect(permissions).toHaveLength(6);for(const p of permissions)expect(p).toMatchObject({a:['record_finance_receivable_adjustment','preview_finance_receivable_adjustment','get_finance_receivable_adjustments'].includes(p.name),n:false,s:false});
 await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
 const target=(await db.query<{id:string}>("insert into receivables(tenant_id,amount,received_amount,status,description,due_date) values($1,100,0,'pending','Public adjustment review',current_date+5) returning id",[i.tenant])).rows[0].id;
 const day=(await db.query<{v:string}>("select (clock_timestamp() at time zone 'America/Sao_Paulo')::date::text v")).rows[0].v;
 await db.exec('set local role authenticated');
 await db.exec('savepoint cross_company');await expect(db.query('select public.preview_finance_receivable_adjustment($1,$2,$3,$4,$5,null)',[i.otherTenant,target,'discount','1000',day])).rejects.toMatchObject({code:'42501'});await db.exec('rollback to savepoint cross_company');
 const preview=receivableAdjustmentPreviewSchema.parse((await db.query<{v:unknown}>('select public.preview_finance_receivable_adjustment($1,$2,$3,$4,$5,null) v',[i.tenant,target,'discount','1000',day])).rows[0].v);expect(preview.can_execute).toBe(true);
 const command=receivableAdjustmentCommandSchema.parse({version:1,tenant_id:i.tenant,request_id:randomUUID(),receivable_id:target,action:'apply',kind:'discount',adjustment_id:null,amount_cents:'1000',effective_on:day,expected_revision:preview.revision,reason:'Public audited discount'});
 const write=async()=>(await db.query<{v:unknown}>('select public.record_finance_receivable_adjustment($1) v',[command])).rows[0].v;const raw=await write();const result=parseReceivableAdjustmentResult(raw,command,i.operator,preview.effects);expect(result.cash_movement_created).toBe(false);expect(await write()).toEqual(raw);
 const history=receivableAdjustmentHistorySchema.parse((await db.query<{v:unknown}>('select public.get_finance_receivable_adjustments($1,$2,$3) v',[i.tenant,target,{offset:0,limit:30,expected_revision:null}])).rows[0].v);expect(history.rows).toHaveLength(1);expect(history.rows[0]).toMatchObject({id:result.event_id,actor_id:i.operator,kind:'discount',amount_cents:'1000'});
 await db.exec('savepoint raw');await expect(db.query('select finance_private.record_receivable_balance_adjustment($1)',[command])).rejects.toMatchObject({code:'42501'});await db.exec('rollback to savepoint raw');await db.exec('reset role');
 await db.query('insert into drivers(id,tenant_id,user_id,active) values($1,$2,$3,true)',[randomUUID(),i.tenant,i.operator]);await db.exec('set local role authenticated');await db.exec('savepoint denied');await expect(write()).rejects.toMatchObject({code:'42501'});await db.exec('rollback to savepoint denied');
 await db.exec('reset role');await db.exec('set constraints all immediate');await db.exec('rollback');
 }finally{await db.close();}
},60000);
