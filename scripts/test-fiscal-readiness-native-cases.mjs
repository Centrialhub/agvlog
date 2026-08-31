import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {installFiscalReadinessFixture,fiscalSnapshot} from '../src/test/helpers/fiscalReadinessDatabase.ts';
import {operationIds as i} from '../src/test/helpers/operationOutcomeDatabase.ts';
export async function runFiscalReadinessNative({query,contested,literal:q}){
 const actor=randomUUID();
 const identity='set request.jwt.claim.sub='+q(actor)+';set request.jwt.claims='+q(JSON.stringify({aal:'aal1'}))+';';
 const api=identity+'set role authenticated;';
 const service='set role service_role;';
 const adapter={exec:query,query:async(sql,params=[])=>{
  const body=sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1]));
  if(!/^\s*(select|with)\b/i.test(body)){await query(identity+body+';');return {rows:[]};}
  return {rows:JSON.parse(await query(identity+'with qa_result as ('+body+") select coalesce(json_agg(to_jsonb(r)),'[]'::json) from qa_result r;"))};
 }};
 const {emitter,client}=await installFiscalReadinessFixture(adapter);
 await query("insert into tenant_memberships(tenant_id,user_id,role,active) values("+q(i.tenant)+','+q(actor)+",'operator',true);");
 assert.equal(await query(api+'select is_tenant_operator_or_admin('+q(i.tenant)+');'),'t');
 const first=randomUUID(),second=randomUUID();
 await query("insert into fiscal_documents(id,tenant_id,invoice_number,document_type,client_id,value,freight_value,status) values ("+q(first)+','+q(i.tenant)+",'QA-FISCAL-A','inbound',"+q(client)+",1000,100,'confirmed'),("+q(second)+','+q(i.tenant)+",'QA-FISCAL-B','inbound',"+q(client)+",1000,100,'confirmed');");
 const prepare=(ids=[first,second],env='homologation')=>api+'select prepare_cte_issue('+q(i.tenant)+','+q(emitter)+','+q(env)+',ARRAY['+ids.map(q).join(',')+']::uuid[],'+q(JSON.stringify(fiscalSnapshot(client,env)))+'::jsonb);';
 const count=()=>query('select count(distinct outbound_id) from fiscal_source_reservations where source_id in('+q(first)+','+q(second)+');');
 const claim=(doc,env='homologation')=>service+'select claim_hub_fiscal_emission('+[q(i.tenant),q(actor),q(emitter),q('cte'),q(env),q(JSON.stringify(fiscalSnapshot(client,env).cte_payload))+'::jsonb',q(doc),'null','null'].join(',')+');';
 const complete=(id,status='authorized')=>service+'select complete_hub_fiscal_emission('+q(i.tenant)+','+q(id)+','+q(JSON.stringify({document:{id:'hub-native',status,number:'900',accessKey:'native-key',authorizationProtocol:'native-protocol'}}))+'::jsonb,200);';
 const tests=[
 ['concurrent preparations of the same sources return one persisted document',async()=>{await contested(prepare(),prepare(),{driver:false});assert.equal(await count(),'1');}],
 ['overlapping source groups cannot create a second fiscal document',async()=>{await assert.rejects(()=>query(prepare([first])),/fiscal_sources_reserved/);assert.equal(await count(),'1');}],
 ['concurrent dispatch claims permit one outbound POST only',async()=>{
  const doc=JSON.parse(await query(prepare())).id;
  const result=await contested(claim(doc),claim(doc),{driver:false});assert.match(result.output,/"dispatch": false/);
  assert.equal(await query('select count(*) from hub_fiscal_emissions where fiscal_document_id='+q(doc)+';'),'1');
 }],
 ['unknown outcome remains reserved across separate database connections',async()=>{
  const doc=JSON.parse(await query(prepare())).id;assert.equal(JSON.parse(await query(claim(doc))).dispatch,false);
  assert.equal(JSON.parse(await query(prepare())).id,doc);
 }],
 ['authorization, financial catalog and homologation exclusion commit together',async()=>{
  const doc=JSON.parse(await query(prepare())).id;const e=JSON.parse(await query(claim(doc))).emission;await query(complete(e.id));
  assert.equal(await query('select status from cte_documents where id='+q(doc)+';'),'authorized');
  assert.equal(await query(api+"select filter_billable_fiscal_sources("+q(i.tenant)+",'cte_document',ARRAY["+q(doc)+']::uuid[]);'),'{}');
  assert.equal(await query('select count(*) from fiscal_documents where id in('+q(first)+','+q(second)+') and cte_emitted_at is not null;'),'0');
 }],
 ['confirmed cancellation does not allow a late processing callback to restore authorization',async()=>{
  const doc=JSON.parse(await query(prepare())).id;const e=JSON.parse(await query(claim(doc))).emission;
  await query(complete(e.id,'cancelled'));await query(complete(e.id,'processing'));
  assert.equal(await query('select status from fiscal_documents where id='+q(doc)+';'),'cancelled');
 }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS fiscal: '+name);}return tests.length;
}

