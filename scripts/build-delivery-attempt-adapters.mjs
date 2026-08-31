// Local authoring only: derives reviewed adapters from the versioned QA stack.
// Never queries production. All file changes go through apply_patch.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createDeliveryAttemptDatabase} from '../src/test/helpers/deliveryAttemptDatabase.ts';
const target='supabase/migrations/20260830142048_enable_audited_delivery_reallocation.sql';
const patch=(before,after)=>execFileSync('C:/Users/Thomaz/AppData/Local/OpenAI/Codex/bin/6ca77c4a9caa4eed/codex.exe',[
 '--codex-run-as-apply-patch','*** Begin Patch\n*** Update File: '+target+'\n@@\n'+before.split('\n').map(l=>'-'+l).join('\n')+'\n'+after.split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch'],{stdio:'inherit'});
if(readFileSync(target,'utf8').includes('-- GENERATED ADAPTER:'))throw new Error('Adapters already materialized; edit the reviewed SQL instead of regenerating over work.');
const {db}=await createDeliveryAttemptDatabase();
const originals=[];const adapters=[];
async function definition(name){
 const rows=(await db.query("select oid::regprocedure::text signature,pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace and proname=$1",[name])).rows;
 if(rows.length!==1)throw new Error('Expected one canonical local function '+name);
 const row=rows[0];row.definition=row.definition.replace(/\r\n/g,'\n');originals.push(row);return row.definition;
}
const exact=(sql,before,after)=>{if(!sql.includes(before))throw new Error('Missing reviewed fragment: '+before);return sql.replace(before,after);};
function active(sql,tables=['load_items','dispatch_stop_documents']){
 for(const table of tables)sql=sql.replace(new RegExp('\\b(from|join|update|into)\\s+public\\.'+table+'\\b','gi'),(_,verb)=>verb+' public.current_'+table);
 return sql;
}
function allocation(sql){
 return sql.replace(/join public\.fiscal_documents f on f\.id=d\.fiscal_document_id/g,'join public.delivery_allocation_documents f on f.allocation_id=d.id');
}
try{
 for(const name of ['_sync_fiscal_document_load_mirror','_load_replanning_snapshot','_assert_load_replanning_graph','_lock_load_document_graph',
  'dispatch_planned_route','replan_load_items','move_load_items_between_loads','upsert_load_item_v3','save_load_item_preparation','delete_load_item_v3','_prepare_delivery_proof']){
  let sql=active(await definition(name));
  // Retired proof versions are historical, not evidence attached to this attempt.
  if(['replan_load_items','move_load_items_between_loads','upsert_load_item_v3'].includes(name)){
   sql=sql.replace(/(from public\.proof_of_delivery(?: p)? where [^\n]*)(\n\s*(?:and )?\()/g,'$1$2');
   sql=sql.replace(/from public\.proof_of_delivery p where p\.fiscal_document_id/g,'from public.current_delivery_proofs p where p.fiscal_document_id');
   sql=sql.replace(/from public\.proof_of_delivery where fiscal_document_id/g,'from public.current_delivery_proofs where fiscal_document_id');
  }
  adapters.push([name,sql]);
 }
 {
  const name='_load_document_change_snapshot';let sql=await definition(name);
  sql=exact(sql,'cte_emitted_at,cte_emitted_outbound_id,nfse_emitted_at','cte_emitted_at,cte_emitted_outbound_id,nfse_emitted_at,current_delivery_attempt_id');adapters.push([name,sql]);
 }
 {
  const name='_change_load_documents';let sql=active(await definition(name));
  sql=exact(sql,"(tenant_id is distinct from _tenant_id or status in('uploaded','validated') or storage_path is not null or photo_url is not null or signature_url is not null or received_at is not null)",
   "(tenant_id is distinct from _tenant_id or (is_active and (status in('uploaded','validated') or storage_path is not null or photo_url is not null or signature_url is not null or received_at is not null)))");
  sql=exact(sql,`  insert into public.current_load_items(tenant_id,load_id,fiscal_document_id,item_description,pallet_count,weight_kg,volume_m3)
   select _tenant_id,_load_id,id,coalesce(nullif(product_summary,''),'Documento '||coalesce(invoice_number,id::text)),
    coalesce(pallet_count,0),coalesce(weight_kg,0),0 from public.fiscal_documents where id=any(v_effective);
  get diagnostics v_items=row_count;`,
  `  insert into public.current_load_items(id,tenant_id,load_id,fiscal_document_id,delivery_attempt_id,source_delivery_item_id,item_description,quantity,pallet_count,weight_kg,volume_m3)
   select gen_random_uuid(),_tenant_id,_load_id,f.id,null,null,coalesce(nullif(f.product_summary,''),'Documento '||coalesce(f.invoice_number,f.id::text)),
    1,coalesce(f.pallet_count,0),coalesce(f.weight_kg,0),0 from public.fiscal_documents f where f.id=any(v_effective) and f.current_delivery_attempt_id is null
   union all
   select (item->>'id')::uuid,_tenant_id,_load_id,f.id,a.id,(item->>'source_item_id')::uuid,item->>'item_description',
    (item->>'quantity')::numeric,(item->>'pallet_count')::integer,(item->>'weight_kg')::numeric,(item->>'volume_m3')::numeric
   from public.fiscal_documents f join public.delivery_attempts a on a.id=f.current_delivery_attempt_id and a.tenant_id=f.tenant_id and a.fiscal_document_id=f.id
   cross join lateral jsonb_array_elements(a.items) item where f.id=any(v_effective);
  get diagnostics v_items=row_count;`);adapters.push([name,sql]);
 }
 {
  const name='_operation_document_context';let sql=active(await definition(name));
  sql=sql.replaceAll('from public.current_delivery_document_outcomes h','from public.active_delivery_document_outcomes h');
  sql=exact(sql,"'is_current',not exists(select 1 from public.delivery_document_corrections c where c.previous_outcome_id=h.id)",
   "'attempt_id',h.delivery_attempt_id,'is_current',h.delivery_attempt_id is not distinct from f.current_delivery_attempt_id and not exists(select 1 from public.delivery_document_corrections c where c.previous_outcome_id=h.id)");adapters.push([name,sql]);
 }
 for(const name of ['_lock_delivery_trip_graph','_derive_driver_delivery_result','_derive_corrected_delivery_result','driver_record_delivery_note']){
  adapters.push([name,allocation(await definition(name))]);
 }
 for(const name of ['record_operation_document_outcome','record_operation_document_correction']){
  let sql=active(await definition(name),['load_items']);sql=allocation(sql);
  sql=sql.replaceAll('from public.current_delivery_document_outcomes','from public.active_delivery_document_outcomes');adapters.push([name,sql]);
 }
 {
  const name='_snapshot_delivery_document_outcome';let sql=active(await definition(name));
  sql=exact(sql,'fiscal_document_id,event_id,source,outcome,occurred_at,actor_id,reason,document_snapshot,items_snapshot,proof_snapshot)',
   'fiscal_document_id,event_id,source,outcome,occurred_at,actor_id,reason,document_snapshot,items_snapshot,proof_snapshot,delivery_attempt_id)');
  sql=exact(sql,'and p.tenant_id=e.tenant_id and p.dispatch_stop_id=d.dispatch_stop_id)',
   'and p.tenant_id=e.tenant_id and p.dispatch_stop_id=d.dispatch_stop_id)');
  sql=exact(sql,"'[]'::jsonb)) returning id into v_id;","'[]'::jsonb),f.current_delivery_attempt_id) returning id into v_id;");adapters.push([name,sql]);
 }
 {
  const name='driver_record_delivery_outcome';let sql=await definition(name);
  const lock=`perform li.id from public.load_items li where exists(select 1 from public.dispatch_stop_documents d
    where d.dispatch_stop_id=_stop_id and d.fiscal_document_id=li.fiscal_document_id) order by li.id for share;`;
  sql=exact(sql,lock,'-- ACTUAL ITEM ROW LOCK');
  sql=sql.replace(/\bfrom public\.load_items\b/g,'from public._delivery_items_for_stop(_stop_id)');
  sql=sql.replace(/\bjoin public\.load_items\b/g,'join public._delivery_items_for_stop(_stop_id)');
  sql=allocation(sql);
  sql=exact(sql,'join public.fiscal_documents f on f.id=h.fiscal_document_id','join public.delivery_allocation_documents f on f.allocation_id=h.dispatch_stop_document_id');
  sql=exact(sql,'-- ACTUAL ITEM ROW LOCK',`perform li.id from public.load_items li where exists(select 1 from public.dispatch_stop_documents d
    where d.dispatch_stop_id=_stop_id and d.fiscal_document_id=li.fiscal_document_id and d.load_id=li.load_id
     and d.delivery_attempt_id is not distinct from li.delivery_attempt_id) order by li.id for share;`);adapters.push([name,sql]);
 }
 const portals=['get_client_portal_summary','search_client_portal_shipments','get_public_shipment_status','get_client_portal_summary_v2',
  'get_client_portal_upcoming_deliveries','get_client_portal_alerts','get_client_portal_reports_summary','get_client_portal_tracking',
  'search_client_portal_shipments_v2','get_client_portal_reports_summary_v2','get_client_portal_shipment_detail','get_client_portal_shipment_detail_v2'];
 for(const name of portals)adapters.push([name,active(await definition(name))]);
 const rows=originals.map(r=>"('public."+r.signature+"','"+createHash('md5').update(r.definition).digest('hex')+"')").join(',\n ');
 patch('-- ADAPTER PREFLIGHT',`do $guard$ declare c record;begin
 if to_regprocedure('public._delivery_attempt_activation_gate()') is null or to_regprocedure('public.request_document_redelivery(jsonb)') is not null then
  raise exception 'Redelivery activation requires untouched attempt foundation';end if;
 for c in select * from(values ${rows}) expected(signature,hash) loop
  if md5(replace(pg_get_functiondef(to_regprocedure(c.signature)),E'\\r\\n',E'\\n')) is distinct from c.hash then
   raise exception 'Redelivery adapter dependency changed: %',c.signature;end if;
 end loop;end;$guard$;`);
 for(const [name,sql] of adapters){
  // Keep individual process arguments below the Windows argument-length limit.
  if(sql.length>26000)throw new Error('Oversized adapter '+name);
  patch('-- CANONICAL ADAPTERS',`-- GENERATED ADAPTER: ${name}\n${sql.trimEnd()};\n\n-- CANONICAL ADAPTERS`);
 }
}finally{await db.close();}
