import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:"export {createCustomerCreditApplicationDatabase} from './src/test/helpers/customerCreditApplicationDatabase'; export {operationIds} from './src/test/helpers/operationOutcomeDatabase';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:globalThis.__financeBenchmarkDb?[{name:'native-transport',setup(b){b.onResolve({filter:/^@electric-sql\/pglite$/},()=>({path:'native',namespace:'native'}));b.onLoad({filter:/.*/,namespace:'native'},()=>({contents:'export class PGlite {constructor(){return globalThis.__financeBenchmarkDb}}',loader:'js'}));}}]:[]});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
const {createCustomerCreditApplicationDatabase,operationIds:i}=mod.exports;
const db=await createCustomerCreditApplicationDatabase();
const report={runtime:(globalThis.__financeBenchmarkDb?'PostgreSQL 17 native':'PGlite')+'; isolated local database-only; no concurrent workload or network',titles:10000,samples:[],files:{}};
const files=['supabase/migrations/20260911101312_finance_customer_credit_applications.sql','supabase/migrations/20260911104429_finance_customer_credit_portfolio_composition.sql'];
try{
 for(const f of files)report.files[f]=createHash('sha256').update(readFileSync(f)).digest('hex');
 await db.exec(readFileSync(files[0],'utf8'));
 const captured=JSON.parse(readFileSync('docs/qa/finance-credit-portfolio-predecessors-2026-09-11.json','utf8').replace(/^\uFEFF/,''));
 for(const f of captured.functions){await db.exec(f.definition);const sig=f.signature.includes('.')?f.signature:'public.'+f.signature;await db.exec('revoke all on function '+sig+' from public,anon,service_role;grant execute on function '+sig+' to authenticated');}
 await db.exec(readFileSync(files[1],'utf8'));
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);
 await db.query("insert into clients(id,tenant_id,company_name,active) select md5('benchmark-client-'||n)::uuid,$1,'Benchmark client '||n,true from generate_series(1,20)n",[i.tenant]);
 await db.query("insert into receivables(id,tenant_id,client_id,amount,received_amount,status,description,due_date,created_at) select md5('benchmark-title-'||n)::uuid,$1,md5('benchmark-client-'||(1+(n%20)))::uuid,100,0,'pending','Benchmark title '||n,date '2026-09-01'+(n%30),timestamp '2026-09-01'+n*interval '1 second' from generate_series(1,10000)n",[i.tenant]);
 for(const idx of JSON.parse(readFileSync('docs/qa/finance-receivable-10k-production-indexes-2026-09-11.json','utf8'))){const found=(await db.query('select 1 from pg_indexes where schemaname=$1 and indexname=$2',[idx.schemaname,idx.indexname])).rows.length;if(!found)await db.exec(idx.indexdef);}
 await db.exec('analyze;set statement_timeout=\'30s\'');
 report.indexes=(await db.query("select schemaname,tablename,indexname,indexdef from pg_indexes where tablename in('receivables','receivables_payments','receivable_payment_reversals','customer_credit_application_events') order by tablename,indexname")).rows;
 report.catalog=(await db.query("select n.nspname,p.proname,md5(replace(p.prosrc,E'\\r\\n',E'\\n')) hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in('receivables_page','receivables_page_by_origin','receivable_portfolio_summary','_receivable_financial_snapshot')")).rows;
 await db.exec('set role authenticated');
 const cases=[['page_first',"select public.get_finance_receivables_page($1,'','all',null,null,null,1) v",10000],['page_deep',"select public.get_finance_receivables_page($1,'','all',null,null,null,200) v",10000],['page_search',"select public.get_finance_receivables_page($1,'title 999','all',null,null,null,1) v",11],['portfolio_all',"select public.get_finance_receivable_portfolio_summary($1,null,null,null) v",10000],['portfolio_client',"select public.get_finance_receivable_portfolio_summary($1,null,null,md5('benchmark-client-1')::uuid) v",500]];
 for(const[name,sql,count]of cases){const times=[];let result,error,warmup_ms;for(let sample=0;sample<(name==='portfolio_all'&&!globalThis.__financeBenchmarkDb?6:21);sample++){const start=performance.now();try{result=(await db.query(sql,[i.tenant])).rows[0].v;}catch(e){error=String(e);times.push(performance.now()-start);break;}const elapsed=performance.now()-start;if(sample>0)times.push(elapsed);if(sample===0)warmup_ms=elapsed;if(sample===0)console.log(name+' warmup '+elapsed.toFixed(1)+'ms');}
 const item={name,milliseconds:times,warmup_ms,error,result_total:result?.total??result?.total_titles,rows:result?.rows?.length};if(result&&name.startsWith('page'))assert.equal(result.total,count);if(result&&name.startsWith('portfolio')){assert.equal(result.total_titles,count);assert.equal(result.totals_valid,true);assert.equal(result.open_cents,String(count*10000));item.portfolio=result;}
 if(times.length>=20){const sorted=[...times].sort((a,b)=>a-b);item.p95_ms=sorted[Math.ceil(.95*sorted.length)-1];}if(globalThis.__financeBenchmarkDb){item.explain=(await db.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql,[i.tenant])).rows;}report.samples.push(item);writeFileSync('docs/qa/finance-receivable-10k-'+(globalThis.__financeBenchmarkDb?'native':'local')+'-benchmark-2026-09-11.json',JSON.stringify(report,null,2));console.log(JSON.stringify(item));}
}finally{await db.close();}
