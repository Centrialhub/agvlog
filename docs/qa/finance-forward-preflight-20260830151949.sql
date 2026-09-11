-- Read-only preflight for 20260830151949_audit_delivery_document_metadata.sql. Run ONLY after its predecessors.
-- Does not execute business functions, certify DDL completion or replace in-transaction guards.
with checks as (
select 'public.request_document_redelivery(jsonb)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.request_document_redelivery(jsonb)')),E'\r\n',E'\n')) is not distinct from 'c30924bdf6e0cea805d0b4b322fd938e' passed
union all
select 'public.record_operation_document_correction(jsonb)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.record_operation_document_correction(jsonb)')),E'\r\n',E'\n')) is not distinct from 'aeab241d45aa3ecb7d010125b3ea8adb' passed
union all
select 'public.get_load_operational_documents(uuid,uuid)' check_name,md5(replace(pg_get_functiondef(to_regprocedure('public.get_load_operational_documents(uuid,uuid)')),E'\r\n',E'\n')) is not distinct from 'b65131dfe113f248566c30a6225f1ee5' passed
union all
select 'redelivery_present',(to_regprocedure('public.request_document_redelivery(jsonb)') is not null)
union all
select 'metadata_absent',(to_regclass('public.delivery_document_metadata_audits') is null)
) select '20260830151949' step,(select count(*) from supabase_migrations.schema_migrations) history_count,jsonb_agg(to_jsonb(checks)) checks,bool_and(coalesce(passed,false)) all_passed from checks;
