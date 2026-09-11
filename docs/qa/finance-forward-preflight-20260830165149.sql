-- Read-only preflight for 20260830165149_make_closing_drafts_atomic.sql. Run ONLY after its predecessors.
-- Does not execute business functions, certify DDL completion or replace in-transaction guards.
with checks(check_name,passed) as (
select 'closing_sources_present',(to_regprocedure('public.get_closing_report_sources(uuid,jsonb)') is not null)
union all
select 'creation_requests_absent',(to_regclass('public.closing_report_creation_requests') is null)
) select '20260830165149' step,(select count(*) from supabase_migrations.schema_migrations) history_count,jsonb_agg(to_jsonb(checks)) checks,bool_and(coalesce(passed,false)) all_passed from checks;
