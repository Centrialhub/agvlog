-- Read-only preflight for 20260830192908_audit_client_invoice_lifecycle.sql. Run ONLY after its predecessors.
-- Does not execute business functions, certify DDL completion or replace in-transaction guards.
with checks(check_name,passed) as (
select 'receivable_command_present',(to_regprocedure('public.apply_receivable_financial_command(jsonb)') is not null)
union all
select 'invoice_commands_absent',(to_regclass('public.client_invoice_commands') is null)
) select '20260830192908' step,(select count(*) from supabase_migrations.schema_migrations) history_count,jsonb_agg(to_jsonb(checks)) checks,bool_and(coalesce(passed,false)) all_passed from checks;
