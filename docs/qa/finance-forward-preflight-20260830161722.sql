-- Read-only preflight for 20260830161722_make_closing_reports_attempt_aware.sql. Run ONLY after its predecessors.
-- Does not execute business functions, certify DDL completion or replace in-transaction guards.
with checks(check_name,passed) as (
select 'metadata_present',(to_regclass('public.delivery_document_metadata_audits') is not null)
union all
select 'current_outcomes_present',(to_regclass('public.current_delivery_document_outcomes') is not null)
union all
select 'allocation_helper_private',(to_regprocedure('public._delivery_allocation_document(uuid)') is not null and not coalesce(has_function_privilege('authenticated',to_regprocedure('public._delivery_allocation_document(uuid)'),'execute'),true) and not coalesce(has_function_privilege('anon',to_regprocedure('public._delivery_allocation_document(uuid)'),'execute'),true))
union all
select 'closing_sources_absent',(to_regprocedure('public.get_closing_report_sources(uuid,jsonb)') is null)
) select '20260830161722' step,(select count(*) from supabase_migrations.schema_migrations) history_count,jsonb_agg(to_jsonb(checks)) checks,bool_and(coalesce(passed,false)) all_passed from checks;
