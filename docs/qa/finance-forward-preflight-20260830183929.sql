-- Read-only preflight for 20260830183929_audit_receivable_payments_and_reversals.sql. Run ONLY after its predecessors.
-- Does not execute business functions, certify DDL completion or replace in-transaction guards.
with checks(check_name,passed) as (
select 'closing_action_present',(to_regprocedure('public.apply_closing_report_action(jsonb)') is not null)
union all
select 'financial_commands_absent',(to_regclass('public.receivable_financial_commands') is null)
) select '20260830183929' step,(select count(*) from supabase_migrations.schema_migrations) history_count,jsonb_agg(to_jsonb(checks)) checks,bool_and(coalesce(passed,false)) all_passed from checks;
