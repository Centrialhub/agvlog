import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';
export async function runInternalTransfersNative({query,contested,literal:q,createRoles=false}){
 const database='finance_transfers_qa';await query(`create database ${database}`);
 const run=sql=>query(sql,database);
 await prepareFinanceLedgerDatabase({exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1])))},createRoles);
 const file='20260910033918_finance_internal_transfer_pairs.sql',sql=readFileSync('supabase/migrations/'+file,'utf8');
 await run('begin;'+sql+'commit;');console.log('Transfer candidate '+file+' SHA256 '+createHash('sha256').update(sql).digest('hex'));
 const transitFile='20260910034731_finance_transfers_in_transit.sql',transitSql=readFileSync('supabase/migrations/'+transitFile,'utf8');
 await run('begin;'+transitSql+'commit;');console.log('Transfer candidate '+transitFile+' SHA256 '+createHash('sha256').update(transitSql).digest('hex'));
 const destination=randomUUID();await run(`insert into bank_accounts(id,tenant_id,active,name) values(${q(destination)},${q(i.tenant)},true,'Destino QA')`);
 const payload=(patch={})=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),source_account_id:i.account,destination_account_id:destination,amount_cents:50000,debited_on:'2026-01-01',credited_on:'2026-01-02',reason:'Transferência concorrente sintética',both_recorded:true,...patch});
 const call=p=>`set request.jwt.claim.sub=${q(i.operator)};set role authenticated;select record_finance_internal_transfer(${q(JSON.stringify(p))}::jsonb)`;
 const race=(holder,waiter,options={})=>contested(holder,waiter,{database,driver:false,...options});
 const counts=()=>run("select (select count(*) from finance_movements)||','||(select count(*) from finance_internal_transfers)||','||(select count(*) from finance_commands)");
 const reset=()=>run(`truncate finance_transfer_departures,finance_internal_transfers,finance_movements,finance_events,finance_commands;update tenant_memberships set active=true where user_id=${q(i.operator)};update bank_accounts set active=true;`);
 const stageCall=p=>`set request.jwt.claim.sub=${q(i.operator)};set role authenticated;select record_finance_transfer_stage(${q(JSON.stringify(p))}::jsonb)`;
 const departure=async()=>JSON.parse(await run(stageCall({version:1,tenant_id:i.tenant,request_id:randomUUID(),stage:'depart',source_account_id:i.account,destination_account_id:destination,amount_cents:50000,occurred_on:'2026-01-01',reason:'Saída de teste aguardando chegada',occurred:true})));
 const arrival=id=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),stage:'arrive',departure_id:id,occurred_on:'2026-01-02',reason:'Chegada de transferência em teste',occurred:true});
 const tests=[
  ['concurrent arrival replay creates only one destination credit',async()=>{
   await reset();const d=await departure(),p=arrival(d.departure_id);await race(stageCall(p),stageCall(p));assert.equal(await counts(),'2,1,2');
  }],
  ['competing arrival requests cannot complete the same departure twice',async()=>{
   await reset();const d=await departure();const result=await race(stageCall(arrival(d.departure_id)),stageCall(arrival(d.departure_id)),{waiterSucceeds:false});
   assert.match(result.error,/finance_transfer_already_arrived/);assert.equal(await counts(),'2,1,2');
  }],
  ['same concurrent transfer request produces exactly two movements and one pair',async()=>{
   await reset();const p=payload();await race(call(p),call(p));assert.equal(await counts(),'2,1,1');
  }],
  ['different concurrent requests cannot duplicate the same bank reference',async()=>{
   await reset();const result=await race(call(payload({source_reference:'PIX-QA'})),call(payload({source_reference:'PIX-QA'})),{waiterSucceeds:false});
   assert.match(result.error,/finance_reference_already_recorded/);assert.equal(await counts(),'2,1,1');
  }],
  ['opposite-direction transfers serialize without leaving half a pair',async()=>{
   await reset();await race(call(payload()),call(payload({source_account_id:destination,destination_account_id:i.account})));assert.equal(await counts(),'4,2,2');
   assert.equal(await run("select sum(case when direction='in' then amount_cents else -amount_cents end) from finance_movements"),'0');
  }],
  ['membership revoked during the finance lock wait is checked before creating either side',async()=>{
   await reset();const result=await race(`select pg_advisory_xact_lock(hashtextextended(${q(i.tenant+':finance')},0))`,call(payload()),{waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where user_id=${q(i.operator)}`});
   assert.match(result.error,/finance_access_denied/);assert.equal(await counts(),'0,0,0');
  }],
  ['account disabled while the transfer waits is reread before either side is inserted',async()=>{
   await reset();const result=await race(`select id from bank_accounts where id=${q(destination)} for update`,call(payload()),{waiterSucceeds:false,holderAfterBlocked:`update bank_accounts set active=false where id=${q(destination)}`});
   assert.match(result.error,/finance_invalid_account/);assert.equal(await counts(),'0,0,0');
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
