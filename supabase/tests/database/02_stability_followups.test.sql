-- Native integration for the five corrective forwards after the captured baseline.
-- Run only in the isolated local database with the seven-user seed. Every write,
-- including immutable financial records, belongs to this transaction and rolls back.
-- No triggers, application ACLs, provider flags or private write tickets are bypassed.
-- Scope: SQL/RLS and persisted effects; excludes HTTP/Auth token issuance, provider
-- calls, receipt-file availability and simultaneous sessions (stale revisions tested).
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
set local search_path=public,extensions;
set local request.headers='{}';
set local request.jwt.claim.sub='';
set local request.jwt.claim.role='';
set local request.jwt.claims='{}';
create extension if not exists pgtap with schema extensions;

do $seed_guard$
begin
  if (select count(*) from auth.users)<>7
    or (select count(*) from auth.users where id::text like '10000000-0000-4000-8000-%'
      and email like '%@agvlog-e2e.invalid')<>7
    or (select count(*) from public.tenants where id in
      ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002')
      and settings->'fixture'='true'::jsonb)<>2 then
    raise exception 'Native followup test requires the isolated seven-user synthetic seed';
  end if;
end;
$seed_guard$;

select no_plan();
create function pg_temp.qa_id(label text) returns uuid language sql immutable as
  $$select md5('agvlog-native-followup-2026-09-28:'||label)::uuid$$;
create function pg_temp.tenant_a() returns uuid language sql immutable as
  $$select '20000000-0000-4000-8000-000000000001'::uuid$$;
create function pg_temp.tenant_b() returns uuid language sql immutable as
  $$select '20000000-0000-4000-8000-000000000002'::uuid$$;
create function pg_temp.result(name text) returns jsonb language sql stable as
  $$select nullif(current_setting('qa.'||name,true),'')::jsonb$$;
create function pg_temp.pallet_payload(items jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object('tenant_id',pg_temp.tenant_a(),'protocol_id',pg_temp.qa_id('pallet'),
    'items',items,'patch',jsonb_build_object('notes','Synthetic native edit'),'reason','Synthetic correction')$$;
create function pg_temp.pallet_state() returns text language sql stable as $$
  select md5(jsonb_build_object('protocol',(select to_jsonb(p) from public.pallet_return_protocols p where id=pg_temp.qa_id('pallet')),
    'items',(select jsonb_agg(to_jsonb(i) order by id) from public.pallet_return_items i where protocol_id=pg_temp.qa_id('pallet')),
    'history',(select jsonb_agg(to_jsonb(h) order by id) from public.pallet_return_history h where protocol_id=pg_temp.qa_id('pallet')))::text)$$;
create function pg_temp.route_payload() returns jsonb language sql stable as $$
  select jsonb_build_object('tenant_id',pg_temp.tenant_a(),'request_id',pg_temp.qa_id('route-request'),
    'name','  Synthetic native route  ','waypoints',jsonb_build_array(
      jsonb_build_object('waypoint_type','origin','label','First'),
      jsonb_build_object('waypoint_type','destination','label','Explicit nine','waypoint_order',9),
      jsonb_build_object('label','Default checkpoint','estimated_duration_min',10)))$$;
create function pg_temp.poll_payload(kind text default 'cte', outcome text default 'authorized') returns jsonb language sql stable as $$
  select jsonb_build_object('tenant_id',pg_temp.tenant_a(),'document_kind',kind,
    'document_id',pg_temp.qa_id(kind||'-document'),'emission_id',pg_temp.qa_id(kind||'-emission'),
    'emission_patch',jsonb_build_object('status',outcome,'message','Synthetic provider result'),
    'document_patch',jsonb_build_object('status',outcome,'sefaz_status',outcome,'status_check_attempts',3),
    'release_sources',outcome in('rejected','cancelled'),
    'event',jsonb_build_object('event_type',outcome,'message','Synthetic poll event',
      'payload',jsonb_build_object('source',kind||'-status-poll','provider',jsonb_build_object('status',outcome))))$$;
create function pg_temp.cte_state() returns text language sql stable as $$
  select md5(jsonb_build_object('emission',(select to_jsonb(e) from public.hub_fiscal_emissions e where id=pg_temp.qa_id('cte-emission')),
    'document',(select to_jsonb(d) from public.fiscal_documents d where id=pg_temp.qa_id('cte-document')),
    'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.entity_audit_log a where entity_id=pg_temp.qa_id('cte-document')))::text)$$;
create function pg_temp.finance_base(request_name text) returns jsonb language sql stable as $$
  select jsonb_build_object('version',1,'tenant_id',pg_temp.tenant_a(),'request_id',pg_temp.qa_id(request_name),
    'reason','Synthetic local financial verification')$$;
create function pg_temp.evidence_page(movement_offset integer) returns jsonb language sql stable as $$
  select public.get_finance_account_period_evidence_page(pg_temp.tenant_a(),pg_temp.qa_id('cash-account'),
    (pg_temp.result('closed')->>'closure_id')::uuid,movement_offset,0,2)$$;

-- Dedicated fixture identities fail on collision; no upsert can overwrite a prior run.
insert into public.pallet_return_protocols(id,tenant_id,protocol_number,supplier_name_snapshot,total_quantity)
values(pg_temp.qa_id('pallet'),pg_temp.tenant_a(),'QA-NATIVE-FOLLOWUP-A','Synthetic supplier A',9),
  (pg_temp.qa_id('foreign-pallet'),pg_temp.tenant_b(),'QA-NATIVE-FOLLOWUP-B','Synthetic supplier B',7);
insert into public.pallet_return_items(tenant_id,protocol_id,pallet_type_code,pallet_type_name,quantity)
values(pg_temp.tenant_a(),pg_temp.qa_id('pallet'),'OLD','Original synthetic pallet',9),
  (pg_temp.tenant_b(),pg_temp.qa_id('foreign-pallet'),'FOREIGN','Foreign synthetic pallet',7);
insert into public.route_templates(id,tenant_id,name)
values(pg_temp.qa_id('foreign-route'),pg_temp.tenant_b(),'Synthetic foreign route');
insert into public.fiscal_documents(id,tenant_id,document_type,status,invoice_number)
values(pg_temp.qa_id('cte-document'),pg_temp.tenant_a(),'outbound','processing','QA-NATIVE-CTE-A'),
  (pg_temp.qa_id('foreign-document'),pg_temp.tenant_b(),'outbound','processing','QA-NATIVE-CTE-B'),
  (pg_temp.qa_id('cte-source'),pg_temp.tenant_a(),'inbound','confirmed','QA-NATIVE-SOURCE');
update public.fiscal_documents set cte_emitted_at=now(),cte_emitted_outbound_id=pg_temp.qa_id('cte-document')
where id=pg_temp.qa_id('cte-source');
insert into public.nfse_documents(id,tenant_id,status,rps_number)
values(pg_temp.qa_id('nfse-document'),pg_temp.tenant_a(),'processing','QA-NATIVE-NFSE');
insert into public.hub_fiscal_emissions(id,tenant_id,doc_type,status,environment,dispatch_state,fiscal_document_id,nfse_document_id)
values(pg_temp.qa_id('cte-emission'),pg_temp.tenant_a(),'cte','pending','homologation','legacy',pg_temp.qa_id('cte-document'),null),
  (pg_temp.qa_id('nfse-emission'),pg_temp.tenant_a(),'nfse','pending','homologation','legacy',null,pg_temp.qa_id('nfse-document'));
insert into public.bank_accounts(id,tenant_id,name,account_type,active)
values(pg_temp.qa_id('cash-account'),pg_temp.tenant_a(),'Synthetic native followup cash','cash',true);

select ok(not has_function_privilege('anon','public.edit_pallet_return_protocol_v1(jsonb)','EXECUTE')
  and has_function_privilege('authenticated','public.edit_pallet_return_protocol_v1(jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','finance_private.save_route_template_unsafe_20260917(jsonb)','EXECUTE')
  and has_function_privilege('authenticated','public.save_route_template_v1(jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.commit_legacy_fiscal_poll_v1(jsonb)','EXECUTE')
  and has_function_privilege('service_role','public.commit_legacy_fiscal_poll_v1(jsonb)','EXECUTE'),
  'corrected entrypoints retain their intended execution boundary');

select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal1","active_tenant_id":"20000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select lives_ok($$select public.edit_pallet_return_protocol_v1(pg_temp.pallet_payload(
  '[{"pallet_type_code":"B","pallet_type_name":"Second","quantity":2},
    {"pallet_type_code":"A","pallet_type_name":"First","quantity":3,"sort_order":9}]'))$$,
  'authenticated pallet edit replaces items through real RLS and writes history');
select results_eq($$select pallet_type_code,quantity,sort_order from public.pallet_return_items
  where protocol_id=pg_temp.qa_id('pallet') order by sort_order$$,
  $$values ('B'::text,2,0),('A'::text,3,9)$$,'pallet replacement preserves explicit and input order');
select is((select total_quantity from public.pallet_return_protocols where id=pg_temp.qa_id('pallet')),5,'pallet total equals the persisted items');
select set_config('qa.pallet_before',pg_temp.pallet_state(),true);
select throws_ok($$select public.edit_pallet_return_protocol_v1(pg_temp.pallet_payload('[{"quantity":0.5},{"quantity":0.5}]'))$$,
  'P0001','invalid_items','fractional inputs cannot create rounded item/total divergence');
select throws_ok($$select public.edit_pallet_return_protocol_v1(pg_temp.pallet_payload('[{"quantity":null}]'))$$,
  'P0001','invalid_items','null quantity is rejected before storage');
select throws_ok($$select public.edit_pallet_return_protocol_v1(pg_temp.pallet_payload('[{"quantity":2147483647},{"quantity":1}]'))$$,
  'P0001','invalid_items','integer overflow is rejected before storage');
select is(pg_temp.pallet_state(),current_setting('qa.pallet_before'),'invalid pallet requests leave protocol, items and history identical');
select throws_ok($$select public.edit_pallet_return_protocol_v1(pg_temp.pallet_payload('[]')||jsonb_build_object('tenant_id',pg_temp.tenant_b(),'protocol_id',pg_temp.qa_id('foreign-pallet')))$$,
  'P0001','operator_required','pallet writer rejects another tenant');
select throws_ok($$select public.edit_pallet_return_protocol_v1(pg_temp.pallet_payload('[]')||jsonb_build_object('protocol_id',pg_temp.qa_id('foreign-pallet')))$$,
  'P0001','protocol_not_found','pallet ID cannot cross the active tenant');
reset role;
update public.pallet_return_protocols set status='confirmed' where id=pg_temp.qa_id('pallet');
set local role authenticated;
select throws_ok($$select public.edit_pallet_return_protocol_v1(pg_temp.pallet_payload('[{"quantity":2}]'))$$,
  'P0001','protocol_locked','a protocol confirmed since the prior edit rejects stale edits');

select lives_ok($$select set_config('qa.route_created',public.save_route_template_v1(pg_temp.route_payload())::text,true)$$,
  'route wrapper creates a route with ordered waypoints');
select lives_ok($$select set_config('qa.route_replayed',public.save_route_template_v1(pg_temp.route_payload())::text,true)$$,
  'route command retries with the same request');
select is(pg_temp.result('route_replayed'),pg_temp.result('route_created'),'route replay returns the exact stored result');
select throws_ok($$select public.save_route_template_v1(pg_temp.route_payload()||'{"name":"Changed request"}'::jsonb)$$,
  '22023','request_payload_mismatch','route request reuse with another payload fails');
reset role;
select results_eq($$select waypoint_order,waypoint_type::text,label from public.route_waypoints
  where route_id=(pg_temp.result('route_created')->>'id')::uuid order by waypoint_order$$,
  $$values (0,'origin'::text,'First'::text),(2,'checkpoint','Default checkpoint'),(9,'destination','Explicit nine')$$,
  'route default enum and both ordinal order forms match the persisted waypoints');
select is((select count(*)::integer from finance_private.atomic_command_results where tenant_id=pg_temp.tenant_a()
  and action='save_route_template' and request_id=pg_temp.qa_id('route-request')),1,'route replay adds no second command result');
set local role authenticated;
select lives_ok($$select set_config('qa.route_updated',public.save_route_template_v1(pg_temp.route_payload()||jsonb_build_object(
  'route_id',pg_temp.result('route_created')->>'id','request_id',pg_temp.qa_id('route-update'),'expected_revision',1,
  'name','Updated synthetic route','waypoints',jsonb_build_array(jsonb_build_object('label','Replacement'))))::text,true)$$,
  'route edit uses the current revision');
select is((pg_temp.result('route_updated')->>'revision')::integer,2,'route revision advances exactly once');
select throws_ok($$select public.save_route_template_v1(pg_temp.route_payload()||jsonb_build_object(
  'route_id',pg_temp.result('route_created')->>'id','request_id',pg_temp.qa_id('route-stale'),'expected_revision',1))$$,
  '40001','route_template_changed','stale route revision is rejected');
select throws_ok($$select public.save_route_template_v1(pg_temp.route_payload()||jsonb_build_object(
  'tenant_id',pg_temp.tenant_b(),'request_id',pg_temp.qa_id('foreign-route-request')))$$,
  '42501','admin_required','route writer rejects another tenant');
reset role;
select is((select count(*)::integer from public.route_waypoints where route_id=(pg_temp.result('route_created')->>'id')::uuid),1,
  'failed route edits leave only the accepted replacement');

-- Legacy CT-e poll in homologation: no provider call, no recorded-production job.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select lives_ok($$select public.commit_legacy_fiscal_poll_v1(pg_temp.poll_payload())$$,'service poll commits CT-e authorization and audit together');
reset role;
select ok((select status='authorized' and status_check_attempts=3 from public.fiscal_documents where id=pg_temp.qa_id('cte-document'))
  and (select status='authorized' from public.hub_fiscal_emissions where id=pg_temp.qa_id('cte-emission')),'poll persists both document and emission');
select is((select count(*)::integer from public.entity_audit_log where entity_id=pg_temp.qa_id('cte-document')
  and tenant_id=pg_temp.tenant_a() and entity_type='fiscal_document' and action='authorized' and source='cte-status-poll'
  and new_data->>'document_kind'='cte' and new_data->>'emission_id'=pg_temp.qa_id('cte-emission')::text),1,
  'CT-e event uses the fiscal audit contract');
select is((select count(*)::integer from public.vehicle_events where tenant_id=pg_temp.tenant_a()),0,'fiscal polling creates no vehicle telemetry');
select set_config('qa.cte_before',pg_temp.cte_state(),true);
set local role service_role;
select throws_ok($$select public.commit_legacy_fiscal_poll_v1(pg_temp.poll_payload()||jsonb_build_object(
  'document_id',pg_temp.qa_id('foreign-document'),'emission_patch',jsonb_build_object('status','cancelled')))$$,
  'P0001','document_not_found','a foreign document fails after the tentative emission update');
reset role;
select is(pg_temp.cte_state(),current_setting('qa.cte_before'),'failed cross-tenant commit rolls back emission, document and audit');
set local role service_role;
select lives_ok($$select public.commit_legacy_fiscal_poll_v1(pg_temp.poll_payload()||'{"event":null}'::jsonb)$$,
  'pending/no-event representation accepts JSON null');
select lives_ok($$select public.commit_legacy_fiscal_poll_v1(pg_temp.poll_payload('cte','cancelled'))$$,
  'CT-e cancellation records the fiscal event and releases its source');
select lives_ok($$select public.commit_legacy_fiscal_poll_v1(pg_temp.poll_payload('nfse','authorized'))$$,
  'NFS-e retains its existing event writer');
reset role;
select ok((select cte_emitted_at is null and cte_emitted_outbound_id is null from public.fiscal_documents where id=pg_temp.qa_id('cte-source')),
  'cancellation releases only the scoped source reference');
select is((select status from public.fiscal_documents where id=pg_temp.qa_id('foreign-document')),'processing','foreign fiscal document remains unchanged');
select is((select count(*)::integer from public.entity_audit_log where entity_id=pg_temp.qa_id('cte-document') and source='cte-status-poll'),2,
  'JSON null creates no extra fiscal event');
select is((select count(*)::integer from public.nfse_events where nfse_id=pg_temp.qa_id('nfse-document') and event_type='authorized'),1,
  'NFS-e authorization event is persisted once');

-- Build the immutable reader fixture through the actual cash opening, movement,
-- count, legacy review and close commands, adapted from financeCashPeriodClose.test.ts.
-- SQL-only receipt fixtures satisfy the real object-existence/metadata guard.
-- They do not assert physical file availability; browser storage tests must do so.
-- These metadata rows and all money movements are reverted by this transaction.
insert into storage.objects(bucket_id,name,metadata)
select 'receipts',pg_temp.tenant_a()::text||'/receipts/native-followup-'||n||'.pdf',
  jsonb_build_object('mimetype','application/pdf','size',128)
from generate_series(1,5,2) n;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal1","active_tenant_id":"20000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select lives_ok($$select public.record_finance_cash_opening(pg_temp.finance_base('cash-opening')||jsonb_build_object(
  'account_id',pg_temp.qa_id('cash-account'),'effective_from','2026-01-01','custodian_name','Synthetic custodian',
  'counts',jsonb_build_array(jsonb_build_object('denomination_cents',1,'quantity',10000))))$$,
  'financial fixture uses the canonical cash opening command');
select lives_ok($$select public.record_finance_movement(pg_temp.finance_base('cash-movement-'||n)||jsonb_build_object(
  'bank_account_id',pg_temp.qa_id('cash-account'),'direction',case when n%2=1 then 'in' else 'out' end,
  'nature','other','amount_cents',n*100,'occurred_on',to_char(date '2026-01-01'+n,'YYYY-MM-DD'),
  'description','Synthetic native cash movement','beneficiary_name','Synthetic custodian',
  'receipt_path',case when n%2=1 then pg_temp.tenant_a()::text||'/receipts/native-followup-'||n||'.pdf' else null end))
  from generate_series(1,5) n$$,'five real commands record synthetic movements, three with receipt references');
select lives_ok($$select set_config('qa.cash_count',public.record_finance_cash_period_count(pg_temp.finance_base('cash-count')||jsonb_build_object(
  'account_id',pg_temp.qa_id('cash-account'),'period_end','2026-01-31','custodian_name','Synthetic custodian',
  'counts',jsonb_build_array(jsonb_build_object('denomination_cents',1,'quantity',10300)),
  'counted_at_boundary','end_of_day'))::text,true)$$,'canonical cash count matches opening plus net movement');
select lives_ok($$select public.review_finance_legacy_cut(pg_temp.finance_base('cash-review')||jsonb_build_object(
  'account_id',pg_temp.qa_id('cash-account'),'from','2026-01-01','to','2026-01-31','sources_reviewed',true,
  'revision',public.get_finance_legacy_cut_review(pg_temp.tenant_a(),pg_temp.qa_id('cash-account'),'2026-01-01','2026-01-31')->>'revision'))$$,
  'canonical command reviews the synthetic account legacy cut');
select lives_ok($$select set_config('qa.close_preview',public.preview_finance_cash_period_close(pg_temp.tenant_a(),pg_temp.qa_id('cash-account'),
  '2026-01-01','2026-01-31',(pg_temp.result('cash_count')->>'count_id')::uuid)::text,true)$$,'cash close preview evaluates real source guards');
select ok((pg_temp.result('close_preview')->>'eligible')::boolean,'synthetic cash period is eligible through the real guards');
select lives_ok($$select set_config('qa.closed',public.close_finance_cash_period(pg_temp.finance_base('cash-close')||jsonb_build_object(
  'account_id',pg_temp.qa_id('cash-account'),'from','2026-01-01','to','2026-01-31',
  'count_id',pg_temp.result('cash_count')->>'count_id','revision',pg_temp.result('close_preview')->>'revision'))::text,true)$$,
  'canonical close command creates the immutable snapshot and dependencies');
select results_eq($$select n,pg_temp.evidence_page(n)->'movement_receipt_summary' from (values(0),(2),(4),(7)) offsets(n)$$,
  $$values (0,'{"identified":3,"missing":2}'::jsonb),(2,'{"identified":3,"missing":2}'::jsonb),
    (4,'{"identified":3,"missing":2}'::jsonb),(7,'{"identified":3,"missing":2}'::jsonb)$$,
  'every evidence page reports integral receipt totals from the canonical closed snapshot');
select results_eq($$select n,jsonb_array_length(pg_temp.evidence_page(n)#>'{snapshot,facts,movements}')
  from (values(0),(2),(4),(7)) offsets(n)$$,$$values (0,2),(2,2),(4,1),(7,0)$$,
  'evidence ordinality preserves bounded pages including the final empty page');
select is(pg_temp.evidence_page(0)->'integrity','{"snapshot_matches_revision":true,"dependencies_match":true}'::jsonb,
  'evidence pages retain actual snapshot and dependency integrity');
select is((pg_temp.evidence_page(7)#>>'{movement_page,total}')::integer,5,'empty page retains the full movement total');
select throws_ok($$select public.get_finance_account_period_evidence_page(pg_temp.tenant_b(),pg_temp.qa_id('cash-account'),
  (pg_temp.result('closed')->>'closure_id')::uuid,0,0,2)$$,'42501','finance_access_denied','evidence reader refuses another tenant');
select throws_ok($$select public.get_finance_account_period_evidence_page(pg_temp.tenant_a(),pg_temp.qa_id('foreign-account'),
  (pg_temp.result('closed')->>'closure_id')::uuid,0,0,2)$$,'22023','finance_period_closure_not_found','evidence reader binds the account to its closure');
select throws_ok($$select pg_temp.evidence_page(-1)$$,'22023','finance_evidence_invalid_offset','evidence reader rejects negative offsets');
reset role;
select is((select count(*)::integer from public.finance_movements where bank_account_id=pg_temp.qa_id('cash-account')),5,
  'closing and reading evidence add no money movements');
select is((select count(*)::integer from public.finance_account_period_closures where account_id=pg_temp.qa_id('cash-account')),1,
  'canonical fixture closes the account once');
set constraints all immediate;
select * from finish();
rollback;
