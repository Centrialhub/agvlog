import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {recordedCostOperationalCoverageSchema} from '../src/lib/financial/recordedCostOperationalCoverageContract.ts';
import {financeIds as ids} from '../src/test/helpers/financeLedgerDatabase.ts';

export async function runRecordedCostOperationalCoverageNative({query,literal:q,session,finish}){
 const migration='supabase/migrations/20260914213840_finance_recorded_cost_operational_coverage.sql';
 const hash=createHash('sha256').update(readFileSync(migration)).digest('hex');
 assert.equal(hash,'463b3e108e714d7015dee86e30415dc45bf24020a3a21ea7e207631b377ecaf9');
 const database='finance_recorded_cost_operational_coverage_qa';
 await query(`create database ${database}`);
 const connection=session('recorded-cost-operational-coverage-fixture',database);
 async function execute(sql){
  const marker=`__QA_${randomUUID().replaceAll('-','')}__`,offset=connection.output.length;
  connection.send(`${sql};select ${q(marker)};`);
  const deadline=Date.now()+60000;
  while(!connection.output.slice(offset).includes(marker)){
   assert.ok(!connection.exited,connection.error);
   assert.ok(Date.now()<deadline,`Fixture SQL timeout: ${sql.slice(0,180)}`);
   await delay(10);
  }
  return connection.output.slice(offset,connection.output.indexOf(marker,offset));
 }
 const sqlLiteral=value=>value==null?'null':typeof value==='boolean'?String(value):typeof value==='number'?String(value):q(typeof value==='object'?JSON.stringify(value):value);
 const db={
  exec:execute,
  query:async(sql,params=[])=>{
   sql=sql.replace(/\$(\d+)/g,(_,number)=>sqlLiteral(params[Number(number)-1])).replace(/;\s*$/,'');
   if(!/^\s*(select|with)\b/i.test(sql)&&!/\breturning\b/i.test(sql)){await execute(sql);return{rows:[]};}
   const wrapped=/^\s*(insert|update|delete)\b/i.test(sql)
    ?`with qa_rows as (${sql}) select coalesce(json_agg(qa_rows),'[]')::text from qa_rows`
    :`select coalesce(json_agg(qa_rows),'[]')::text from (${sql}) qa_rows`;
   return{rows:JSON.parse((await execute(wrapped)).trim()||'[]')};
  },
  close:async()=>{},
 };
 const bundle=await build({
  entryPoints:['src/test/helpers/recordedCostOperationalCoverageNativeFixture.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',
  plugins:[{name:'native-sql-transport',setup(builder){
   builder.onResolve({filter:/^@electric-sql\/pglite$/},()=>({path:'native-pglite',namespace:'native'}));
   builder.onLoad({filter:/.*/,namespace:'native'},()=>({contents:'export class PGlite {constructor(){return globalThis.__recordedCostOperationalCoverageNativeDb}}',loader:'js'}));
  }}],
 });
 globalThis.__recordedCostOperationalCoverageNativeDb=db;
 const module={exports:{}};
 new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
 await module.exports.prepareRecordedCostOperationalCoverageNativeFixture();
 await finish(connection,'');
 delete globalThis.__recordedCostOperationalCoverageNativeDb;

 const run=sql=>query(sql,database);
 const identity=actor=>`select set_config('request.jwt.claim.sub',${q(actor)},false);`;
 const auth=actor=>`${identity(actor)}set role authenticated;`;
 const json=async sql=>JSON.parse((await run(sql)).split(/\r?\n/).filter(Boolean).at(-1));
 const read=async({tenant=ids.tenant,from=null,to=null,actor=ids.operator}={})=>recordedCostOperationalCoverageSchema.parse(await json(`${auth(actor)}select get_finance_recorded_cost_operational_coverage(${q(tenant)},${from==null?'null':`${q(from)}::date`},${to==null?'null':`${q(to)}::date`});`));
 const moneySnapshot=()=>json(`select jsonb_build_object('payables',(select count(*) from payables),'payments',(select count(*) from payables_payments),'movements',(select count(*) from finance_movements),'bank_transactions',(select count(*) from bank_transactions),'fiscal_documents',(select count(*) from fiscal_documents));`);
 async function canonicalCost(amount,date,context='maintenance'){
  const batch=randomUUID(),cost=randomUUID();
  await run(`insert into finance_expense_batches(id,tenant_id,context,description,created_by) values(${q(batch)},${q(ids.tenant)},${q(context)},'Cobertura operacional QA',${q(ids.operator)});insert into finance_expense_items(id,tenant_id,batch_id,category,description,amount_cents,occurred_on,supplier_name,no_receipt_reason,created_by) values(${q(cost)},${q(ids.tenant)},${q(batch)},'maintenance','Custo canônico QA',${amount},${q(date)},'Fornecedor QA','Documento conferido',${q(ids.operator)});`);
  return cost;
 }
 async function legacySource(date='2026-02-10T12:00:00Z',amount=30){
  const expense=randomUUID(),cost=await canonicalCost(amount*100,date.slice(0,10)),link=randomUUID();
  await run(`insert into driver_expenses(id,tenant_id,driver_id,category,amount,expense_at,approval_status,reimbursable,payment_source) values(${q(expense)},${q(ids.tenant)},${q(ids.driver)},'food',${amount},${q(date)},'approved',false,'company_account');insert into finance_legacy_expense_cost_links(id,tenant_id,expense_id,cost_id,amount_cents,actor_id,actor_name,reason,source_snapshot) values(${q(link)},${q(ids.tenant)},${q(expense)},${q(cost)},${amount*100},${q(ids.operator)},'Financeiro QA','Associação operacional conferida','{}');`);
  return{expense,cost,link};
 }
 let passed=0;
 const pass=label=>{passed++;console.log(`PASS ${label}`);};

 const permissions=await json(`select jsonb_build_object(
  'public_stable',(select provolatile='s' from pg_proc where oid='public.get_finance_recorded_cost_operational_coverage(uuid,date,date)'::regprocedure),
  'public_invoker',(select not prosecdef from pg_proc where oid='public.get_finance_recorded_cost_operational_coverage(uuid,date,date)'::regprocedure),
  'public_path',(select proconfig @> array['search_path=""'] from pg_proc where oid='public.get_finance_recorded_cost_operational_coverage(uuid,date,date)'::regprocedure),
  'public_auth',has_function_privilege('authenticated','public.get_finance_recorded_cost_operational_coverage(uuid,date,date)','execute'),
  'public_anon',has_function_privilege('anon','public.get_finance_recorded_cost_operational_coverage(uuid,date,date)','execute'),
  'public_service',has_function_privilege('service_role','public.get_finance_recorded_cost_operational_coverage(uuid,date,date)','execute'),
  'private_stable',(select provolatile='s' from pg_proc where oid='finance_private.recorded_cost_operational_coverage(uuid,date,date)'::regprocedure),
  'private_definer',(select prosecdef from pg_proc where oid='finance_private.recorded_cost_operational_coverage(uuid,date,date)'::regprocedure),
  'private_path',(select proconfig @> array['search_path=""'] from pg_proc where oid='finance_private.recorded_cost_operational_coverage(uuid,date,date)'::regprocedure),
  'private_auth',has_function_privilege('authenticated','finance_private.recorded_cost_operational_coverage(uuid,date,date)','execute'),
  'private_anon',has_function_privilege('anon','finance_private.recorded_cost_operational_coverage(uuid,date,date)','execute'),
  'private_service',has_function_privilege('service_role','finance_private.recorded_cost_operational_coverage(uuid,date,date)','execute'),
  'private_schema_auth',has_schema_privilege('authenticated','finance_private','usage'))`);
 assert.deepEqual(permissions,{public_stable:true,public_invoker:true,public_path:true,public_auth:true,public_anon:false,public_service:false,private_stable:true,private_definer:true,private_path:true,private_auth:true,private_anon:false,private_service:false,private_schema_auth:true});
 await assert.rejects(()=>run(`set role anon;select get_finance_recorded_cost_operational_coverage(${q(ids.tenant)},null,null);`),/permission denied/);
 const wrappedEmpty=await read(),privateEmpty=recordedCostOperationalCoverageSchema.parse(await json(`${auth(ids.operator)}select finance_private.recorded_cost_operational_coverage(${q(ids.tenant)},null,null);`));
 assert.deepEqual(privateEmpty,wrappedEmpty);
 await assert.rejects(()=>run(`${auth(ids.operator)}select finance_private.recorded_cost_operational_coverage(${q(ids.otherTenant)},null,null);`),/finance_access_denied/);
 pass('stable invoker wrapper and guarded definer helper expose equivalent authenticated, tenant-scoped reads');

 const order=randomUUID(),directPart=randomUUID(),stockPart=randomUUID(),item=randomUUID(),inbound=randomUUID(),consumption=randomUUID();
 const laborCost=await canonicalCost(5000,'2026-01-10'),directCost=await canonicalCost(5000,'2026-01-10'),acquisitionCost=await canonicalCost(5000,'2026-01-05');
 const laborClaim=randomUUID(),directClaim=randomUUID(),acquisitionLink=randomUUID(),attribution=randomUUID();
 await run(`insert into maintenance_orders(id,tenant_id,order_number,status,opened_at,parts_cost,labor_cost,total_cost) values(${q(order)},${q(ids.tenant)},'OS cobertura completa','completed','2026-01-10T12:00:00Z',60,50,110);insert into stock_items(id,tenant_id,name,category,unit) values(${q(item)},${q(ids.tenant)},'Filtro QA','filter','un');insert into stock_movements(id,tenant_id,stock_item_id,movement_type,quantity,unit_cost,total_cost,reason,moved_at) values(${q(inbound)},${q(ids.tenant)},${q(item)},'inbound',10,5,50,'purchase','2026-01-05T12:00:00Z');insert into stock_movements(id,tenant_id,stock_item_id,maintenance_order_id,movement_type,quantity,unit_cost,total_cost,reason,moved_at) values(${q(consumption)},${q(ids.tenant)},${q(item)},${q(order)},'consumption',2,5,10,'maintenance','2026-01-10T12:00:00Z');insert into maintenance_parts(id,tenant_id,maintenance_order_id,item_description,quantity,unit_cost,total_cost) values(${q(directPart)},${q(ids.tenant)},${q(order)},'Peça direta QA',1,50,50);insert into maintenance_parts(id,tenant_id,maintenance_order_id,stock_item_id,stock_movement_id,item_description,quantity,unit_cost,total_cost) values(${q(stockPart)},${q(ids.tenant)},${q(order)},${q(item)},${q(consumption)},'Filtro consumido QA',2,5,10);insert into finance_maintenance_cost_claims(tenant_id,cost_id,source_kind,source_id,link_id) values(${q(ids.tenant)},${q(laborCost)},'labor',${q(order)},${q(laborClaim)}),(${q(ids.tenant)},${q(directCost)},'direct_part',${q(directPart)},${q(directClaim)});insert into finance_stock_acquisition_links(id,tenant_id,inbound_movement_id,stock_item_id,cost_id,supplier_id,quantity,amount_cents,actor_id,actor_name,reason,source_snapshot) values(${q(acquisitionLink)},${q(ids.tenant)},${q(inbound)},${q(item)},${q(acquisitionCost)},${q(randomUUID())},10,5000,${q(ids.operator)},'Financeiro QA','Aquisição operacional conferida','{}');insert into finance_stock_consumption_attributions(id,tenant_id,part_id,consumption_movement_id,order_id,policy,revision,source_snapshot,actor_id,actor_name,reason) values(${q(attribution)},${q(ids.tenant)},${q(stockPart)},${q(consumption)},${q(order)},'remaining_balance_floor_v1','qa-revision','{}',${q(ids.operator)},'Financeiro QA','Consumo operacional conferido');insert into finance_stock_consumption_lines(tenant_id,attribution_id,acquisition_link_id,quantity,amount_cents,balance_snapshot) values(${q(ids.tenant)},${q(attribution)},${q(acquisitionLink)},2,1000,'{}');`);
 await legacySource('2026-01-11T12:00:00Z',30);
 const before=await moneySnapshot(),complete=await read({from:'2026-01-01',to:'2026-01-31'}),after=await moneySnapshot();
 assert.deepEqual(after,before);
 assert.deepEqual(complete,{version:1,tenant_id:ids.tenant,from:'2026-01-01',to:'2026-01-31',filter_scope:'period_only',coverage_complete:false,totals_additive:false,double_counted_cents:'0',recognized_cost_count:4,recognized_cost_needs_review_count:0,recognized_cost_cents:'18000',review_pending_count:0,maintenance:{labor:{covered_count:1,pending_count:0},direct_parts:{covered_count:1,pending_count:0},stock_acquisitions:{covered_count:1,pending_count:0},stock_consumptions:{covered_count:1,pending_count:0,attribution_count:1,attributed_cents:'1000'},ambiguous_order_count:0},legacy_driver_expenses:{covered_count:1,pending_count:0},detail_readers:['get_finance_legacy_cost_inventory','get_finance_maintenance_cost_context','get_finance_maintenance_labor_context','get_finance_maintenance_direct_part_context','get_finance_stock_acquisition_inventory','get_finance_stock_consumption_context']});
 pass('all operational origins resolve to four distinct canonical costs without mutating money or fiscal tables');

 const reversible=await legacySource();
 let result=await read({from:'2026-02-01',to:'2026-02-28'});
 assert.equal(result.recognized_cost_count,1);assert.equal(result.recognized_cost_cents,'3000');assert.deepEqual(result.legacy_driver_expenses,{covered_count:1,pending_count:0});
 await run(`insert into finance_legacy_expense_cost_reversals(tenant_id,link_id,actor_id,actor_name,reason) values(${q(ids.tenant)},${q(reversible.link)},${q(ids.operator)},'Financeiro QA','Reversão operacional conferida');`);
 result=await read({from:'2026-02-01',to:'2026-02-28'});
 assert.equal(result.recognized_cost_count,0);assert.equal(result.recognized_cost_cents,'0');assert.equal(result.review_pending_count,1);assert.deepEqual(result.legacy_driver_expenses,{covered_count:0,pending_count:1});
 pass('reversing a legacy association removes the canonical recognition and restores the pending source');

 const orphanOrder=randomUUID(),orphanCost=randomUUID();
 await run(`insert into maintenance_orders(id,tenant_id,order_number,status,opened_at,parts_cost,labor_cost,total_cost) values(${q(orphanOrder)},${q(ids.tenant)},'OS vínculo inválido','completed','2026-03-10T12:00:00Z',0,25,25);insert into finance_maintenance_cost_claims(tenant_id,cost_id,source_kind,source_id,link_id) values(${q(ids.tenant)},${q(orphanCost)},'labor',${q(orphanOrder)},${q(randomUUID())});`);
 result=await read({from:'2026-03-01',to:'2026-03-31'});
 assert.equal(result.recognized_cost_count,1);assert.equal(result.recognized_cost_needs_review_count,1);assert.equal(result.recognized_cost_cents,null);assert.equal(result.maintenance.labor.covered_count,1);
 pass('an orphan recognized association is explicit review evidence and never invents a monetary total');

 await run(`insert into maintenance_orders(tenant_id,order_number,status,opened_at,parts_cost,labor_cost,total_cost) values(${q(ids.tenant)},'Limite anterior','completed','2026-04-01T02:59:59Z',0,11,11),(${q(ids.tenant)},'Limite incluído','completed','2026-04-01T03:00:00Z',0,22,22),(${q(ids.otherTenant)},'Outra empresa','completed','2026-04-01T12:00:00Z',0,99,99);`);
 result=await read({from:'2026-04-01',to:'2026-04-01'});
 assert.equal(result.review_pending_count,1);assert.deepEqual(result.maintenance.labor,{covered_count:0,pending_count:1});
 await assert.rejects(()=>read({actor:ids.driverUser}),/finance_access_denied/);
 await assert.rejects(()=>read({tenant:ids.otherTenant}),/finance_access_denied/);
 await assert.rejects(()=>read({from:'2026-04-02',to:'2026-04-01'}),/finance_invalid_cost_filters/);
 await assert.rejects(()=>read({from:'infinity'}),/finance_invalid_cost_filters/);
 await run(`update tenant_memberships set active=false where tenant_id=${q(ids.tenant)} and user_id=${q(ids.operator)};`);
 await assert.rejects(()=>read(),/finance_access_denied/);
 await run(`update tenant_memberships set active=true where tenant_id=${q(ids.tenant)} and user_id=${q(ids.operator)};`);
 pass('São Paulo day boundaries, invalid filters, inactive access, drivers and foreign tenants are enforced');

 await run(`insert into maintenance_orders(tenant_id,order_number,status,opened_at,parts_cost,labor_cost,total_cost) select ${q(ids.tenant)},'OS escala '||n,'completed','2027-01-15T12:00:00Z',0,1,1 from generate_series(1,1005)n;`);
 const started=Date.now();
 result=await read({from:'2027-01-01',to:'2027-01-31'});
 const elapsed=Date.now()-started;
 assert.equal(result.recognized_cost_count,0);assert.equal(result.recognized_cost_cents,'0');assert.equal(result.review_pending_count,1005);assert.deepEqual(result.maintenance.labor,{covered_count:0,pending_count:1005});assert.ok(elapsed<5000,`Coverage read took ${elapsed}ms`);
 const plan=await run(`${auth(ids.operator)}explain(analyze,buffers,format text) select get_finance_recorded_cost_operational_coverage(${q(ids.tenant)},'2027-01-01','2027-01-31');`);
 assert.match(plan,/Execution Time:\s*[0-9.]+ ms/);
 pass(`1005-source aggregate remains exact and completes in ${elapsed}ms with EXPLAIN ANALYZE evidence`);

 console.log(`CANDIDATE ${migration} SHA256 ${hash}`);
 return passed;
}
