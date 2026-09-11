import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
export async function runCreditNative({query,literal:q,session,finish}){
 const database='finance_credit_qa';await query('create database '+database);const connection=session('open-complement-fixture',database);
 async function execute(sql){const marker='__QA_'+randomUUID().replaceAll('-','')+'__';const offset=connection.output.length;connection.send(sql+';select '+q(marker)+';');const deadline=Date.now()+45000;while(!connection.output.slice(offset).includes(marker)){assert.ok(!connection.exited,connection.error);assert.ok(Date.now()<deadline,'Fixture SQL timeout: '+sql.slice(0,180));await delay(10);}return connection.output.slice(offset,connection.output.indexOf(marker,offset));}
 const literal=v=>v==null?'null':typeof v==='boolean'?String(v):typeof v==='number'?String(v):q(typeof v==='object'?JSON.stringify(v):v);
 const db={exec:execute,query:async(sql,params=[])=>{sql=sql.replace(/\$(\d+)/g,(_,n)=>literal(params[Number(n)-1])).replace(/;\s*$/,'');if(!/^\s*(select|with|explain)\b/i.test(sql)&&! /\breturning\b/i.test(sql)){await execute(sql);return{rows:[]};}if(/^explain/i.test(sql)){return {rows:JSON.parse((await execute(sql)).trim())};}const wrapped=/^\s*(insert|update|delete)\b/i.test(sql)?'with qa_rows as ('+sql+') select coalesce(json_agg(qa_rows),\'[]\')::text from qa_rows':'select coalesce(json_agg(qa_rows),\'[]\')::text from ('+sql+') qa_rows';const text=await execute(wrapped);return{rows:JSON.parse(text.trim()||'[]')};},close:async()=>{}};

 globalThis.__financeBenchmarkDb=db; try {await import('./benchmark-finance-receivables-10k.mjs');} finally{delete globalThis.__financeBenchmarkDb;await finish(connection,'');}return {passed:5,findings:0};
}
