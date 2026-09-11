-- Read-only preflight for 20260830174819_audit_closing_lifecycle_and_charge_claims.sql. Run ONLY after its predecessors.
-- Does not execute business functions, certify DDL completion or replace in-transaction guards.
with checks(check_name,passed) as (
select 'draft_command_present',(to_regprocedure('public.create_closing_report_draft(jsonb)') is not null)
union all
select 'actions_absent',(to_regclass('public.closing_report_action_requests') is null)
) select '20260830174819' step,(select count(*) from supabase_migrations.schema_migrations) history_count,jsonb_agg(to_jsonb(checks)) checks,bool_and(coalesce(passed,false)) all_passed from checks;
