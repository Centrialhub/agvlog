-- Read-only preflight for 20260830142048_enable_audited_delivery_reallocation.sql. Run ONLY after its predecessors.
-- Does not execute business functions, certify DDL completion or replace in-transaction guards.
with checks as (
select 'public._sync_fiscal_document_load_mirror()' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public._sync_fiscal_document_load_mirror()')),E'\r\n',E'\n')) is not distinct from '098af8ebf9e9defbc4153f7b6fba43e4' passed
union all
select 'public._load_replanning_snapshot(uuid,uuid[])' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public._load_replanning_snapshot(uuid,uuid[])')),E'\r\n',E'\n')) is not distinct from '805fbe6706cde044e5904baaf6edea52' passed
union all
select 'public._assert_load_replanning_graph(uuid,uuid[])' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public._assert_load_replanning_graph(uuid,uuid[])')),E'\r\n',E'\n')) is not distinct from '88587d953ac20149f3beb9a825d42275' passed
union all
select 'public._lock_load_document_graph(uuid,uuid)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public._lock_load_document_graph(uuid,uuid)')),E'\r\n',E'\n')) is not distinct from '56f03495204150746ffd94a12a25b340' passed
union all
select 'public.dispatch_planned_route(jsonb)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.dispatch_planned_route(jsonb)')),E'\r\n',E'\n')) is not distinct from '7b9c529c986d872eb1ee06ba384ddd62' passed
union all
select 'public.replan_load_items(jsonb)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.replan_load_items(jsonb)')),E'\r\n',E'\n')) is not distinct from '8dbd165b7b03de00262955d5a8d3082b' passed
union all
select 'public.move_load_items_between_loads(uuid,uuid,uuid,uuid[])' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.move_load_items_between_loads(uuid,uuid,uuid,uuid[])')),E'\r\n',E'\n')) is not distinct from '7ac9704abb7f610328b22b1e9f129d99' passed
union all
select 'public.upsert_load_item_v3(uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,text,text,uuid)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.upsert_load_item_v3(uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,text,text,uuid)')),E'\r\n',E'\n')) is not distinct from '04a3da6fbb4fe20bf8fc0ef4d59d7908' passed
union all
select 'public.save_load_item_preparation(jsonb)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.save_load_item_preparation(jsonb)')),E'\r\n',E'\n')) is not distinct from 'effc26025f50cecaa5dd5c44818de186' passed
union all
select 'public.delete_load_item_v3(uuid,uuid)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.delete_load_item_v3(uuid,uuid)')),E'\r\n',E'\n')) is not distinct from 'fe43393cb817dfaa323e226e35a54566' passed
union all
select 'public._prepare_delivery_proof(uuid,uuid,uuid,uuid)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public._prepare_delivery_proof(uuid,uuid,uuid,uuid)')),E'\r\n',E'\n')) is not distinct from '3eb2c7514a4bc60281e8e9956daaa81d' passed
union all
select 'public._load_document_change_snapshot(uuid,uuid,uuid[])' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public._load_document_change_snapshot(uuid,uuid,uuid[])')),E'\r\n',E'\n')) is not distinct from '3a6c5df0074fb6622405b64bdc397fd4' passed
union all
select 'public._change_load_documents(uuid,uuid,uuid[],text,jsonb,text,text)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public._change_load_documents(uuid,uuid,uuid[],text,jsonb,text,text)')),E'\r\n',E'\n')) is not distinct from '4709abef93d37fd2f61aca104bb8ca77' passed
union all
select 'public._operation_document_context(uuid,uuid,uuid)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public._operation_document_context(uuid,uuid,uuid)')),E'\r\n',E'\n')) is not distinct from 'e6457abab0fc5bc8b663f7c097446153' passed
union all
select 'public._lock_delivery_trip_graph(uuid,uuid)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public._lock_delivery_trip_graph(uuid,uuid)')),E'\r\n',E'\n')) is not distinct from 'ffa8920db62358d266660d11685ed9c0' passed
union all
select 'public._derive_driver_delivery_result(uuid,uuid)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public._derive_driver_delivery_result(uuid,uuid)')),E'\r\n',E'\n')) is not distinct from '31a4a4ec4f9a00f7bf7df2f96ede223a' passed
union all
select 'public._derive_corrected_delivery_result(uuid,uuid,uuid)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public._derive_corrected_delivery_result(uuid,uuid,uuid)')),E'\r\n',E'\n')) is not distinct from 'bc1138378ce374615e7227b45bd22660' passed
union all
select 'public.driver_record_delivery_note(uuid,text,jsonb,uuid)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.driver_record_delivery_note(uuid,text,jsonb,uuid)')),E'\r\n',E'\n')) is not distinct from '65c6456a38ade57bb4c7137bc81d1f16' passed
union all
select 'public.record_operation_document_outcome(jsonb)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.record_operation_document_outcome(jsonb)')),E'\r\n',E'\n')) is not distinct from 'bc9c55ae4aeea3a7fe53227ba34cbf30' passed
union all
select 'public.record_operation_document_correction(jsonb)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.record_operation_document_correction(jsonb)')),E'\r\n',E'\n')) is not distinct from 'be885bd42fe5a3a6b97840d97d571173' passed
union all
select 'public._snapshot_delivery_document_outcome(uuid,uuid,text,timestamp with time zone)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public._snapshot_delivery_document_outcome(uuid,uuid,text,timestamp with time zone)')),E'\r\n',E'\n')) is not distinct from '87045bcd032515b747b8427f76d10626' passed
union all
select 'public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text)')),E'\r\n',E'\n')) is not distinct from 'c3ce3d1b62954f5fc4d91567ad51f477' passed
union all
select 'public.get_client_portal_summary(uuid,date,date)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.get_client_portal_summary(uuid,date,date)')),E'\r\n',E'\n')) is not distinct from 'c8c0b69d52f86ccc8cedecaab9ef3d88' passed
union all
select 'public.search_client_portal_shipments(uuid,text,text[],date,date,text,text,boolean,boolean,integer,integer)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.search_client_portal_shipments(uuid,text,text[],date,date,text,text,boolean,boolean,integer,integer)')),E'\r\n',E'\n')) is not distinct from '7619d324a55c4c922108ace1b1f354a8' passed
union all
select 'public.get_public_shipment_status(uuid)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.get_public_shipment_status(uuid)')),E'\r\n',E'\n')) is not distinct from '76dbb1dd1befb1f9ee739309a8117bdf' passed
union all
select 'public.get_client_portal_summary_v2(uuid,uuid,date,date)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.get_client_portal_summary_v2(uuid,uuid,date,date)')),E'\r\n',E'\n')) is not distinct from 'b85a4e5eda4167f04b75625cc8e5fd3d' passed
union all
select 'public.get_client_portal_upcoming_deliveries(uuid,uuid,integer)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.get_client_portal_upcoming_deliveries(uuid,uuid,integer)')),E'\r\n',E'\n')) is not distinct from 'ed1e9a246a51f1efec058fe6f99958af' passed
union all
select 'public.get_client_portal_alerts(uuid,uuid,integer)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.get_client_portal_alerts(uuid,uuid,integer)')),E'\r\n',E'\n')) is not distinct from 'acb2725b83d6129b354eb06705ded789' passed
union all
select 'public.get_client_portal_reports_summary(uuid,date,date)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.get_client_portal_reports_summary(uuid,date,date)')),E'\r\n',E'\n')) is not distinct from '8238ef5a4cd5e1edd7161ba0a7192fb1' passed
union all
select 'public.get_client_portal_tracking(uuid,uuid)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.get_client_portal_tracking(uuid,uuid)')),E'\r\n',E'\n')) is not distinct from 'dece9861ad68fd8da1dc8bdd04a5680f' passed
union all
select 'public.search_client_portal_shipments_v2(uuid,uuid,text,text[],date,date,text,text,boolean,boolean,integer,integer)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.search_client_portal_shipments_v2(uuid,uuid,text,text[],date,date,text,text,boolean,boolean,integer,integer)')),E'\r\n',E'\n')) is not distinct from '0f5eca9d7d9e94f6120cbab7bdd894fb' passed
union all
select 'public.get_client_portal_reports_summary_v2(uuid,uuid,date,date)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.get_client_portal_reports_summary_v2(uuid,uuid,date,date)')),E'\r\n',E'\n')) is not distinct from 'fb440bceee6e9c39c4d4db5b5551d667' passed
union all
select 'public.get_client_portal_shipment_detail(uuid)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.get_client_portal_shipment_detail(uuid)')),E'\r\n',E'\n')) is not distinct from 'e945bca2973bbb0a4c55f7b0b1dc89c2' passed
union all
select 'public.get_client_portal_shipment_detail_v2(uuid)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.get_client_portal_shipment_detail_v2(uuid)')),E'\r\n',E'\n')) is not distinct from 'c63051bee129c4c234ec9f9864de4aac' passed
union all
select 'public._guard_recorded_delivery_document()' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public._guard_recorded_delivery_document()')),E'\r\n',E'\n')) is not distinct from 'aa2546392b8791f9ad25e70152a70925' passed
union all
select 'public._delivery_attempt_activation_gate()' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public._delivery_attempt_activation_gate()')),E'\r\n',E'\n')) is not distinct from '5441120d6f1163d668706163577b0552' passed
union all
select 'public._delivery_allocation_document(uuid)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public._delivery_allocation_document(uuid)')),E'\r\n',E'\n')) is not distinct from '3ab397f23cc0cc4cf4c3d1b4dcca0f5a' passed
union all
select 'public._validate_delivery_attempt()' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public._validate_delivery_attempt()')),E'\r\n',E'\n')) is not distinct from '7bcb4f9710172675e277acb42d853a96' passed
union all
select 'public._guard_delivery_attempt_head()' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public._guard_delivery_attempt_head()')),E'\r\n',E'\n')) is not distinct from 'e7dea2573244e3b63c50aecf7ac5bd79' passed
union all
select 'public._guard_delivery_allocation_rows()' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public._guard_delivery_allocation_rows()')),E'\r\n',E'\n')) is not distinct from '2a5e943e94ba4a974f3be6f3fc97aa58' passed
union all
select 'public._delivery_redelivery_remainder(uuid)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public._delivery_redelivery_remainder(uuid)')),E'\r\n',E'\n')) is not distinct from '5a800460fd21fe458e772ac44042c6e6' passed
union all
select 'public._delivery_attempt_financial_snapshot(uuid,uuid)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public._delivery_attempt_financial_snapshot(uuid,uuid)')),E'\r\n',E'\n')) is not distinct from 'fa7fec65bbea50411d65e45064226039' passed
union all
select 'public._build_driver_settlement(uuid,uuid)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public._build_driver_settlement(uuid,uuid)')),E'\r\n',E'\n')) is not distinct from '63b038ea6e61f0d53da3bc7f9b6839cd' passed
union all
select 'attempt_gate_exists',(to_regprocedure('public._delivery_attempt_activation_gate()') is not null)
union all
select 'redelivery_absent',(to_regprocedure('public.request_document_redelivery(jsonb)') is null)
) select '20260830142048' step,(select count(*) from supabase_migrations.schema_migrations) history_count,jsonb_agg(to_jsonb(checks)) checks,bool_and(coalesce(passed,false)) all_passed from checks;
