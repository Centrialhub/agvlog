-- SELECT-only. Run before rollout and after two scheduled minutes; no worker calls.
select jobid,jobname,schedule,command,active,database,username from cron.job
where jobname in ('finance-fiscal-projection-every-minute','finance-bank-reconciliation-every-minute') order by jobid;
select finance_private.account_period_guards_ready() period_ready,finance_private.movement_correction_readiness() correction_readiness;
select version,name from supabase_migrations.schema_migrations where version in ('20260911042530','20260911043147') or name like '%known_workers_resume%';
select status,issue,last_error_code,count(*) total from public.finance_fiscal_projection_jobs group by status,issue,last_error_code order by status,issue;
select status,count(*) total from public.finance_automatic_reconciliation_jobs group by status order by status;
with classified as (select o.snapshot->>'doc_type' doc_type,o.snapshot->>'status' fiscal_status,finance_private.fiscal_receivable_basis_internal(o.tenant_id,o.id) basis from public.finance_fiscal_observations o)
select doc_type,fiscal_status,coalesce((basis->>'ready')::boolean,false) basis_ready,basis->'issues' issues,count(*) total
from classified group by doc_type,fiscal_status,coalesce((basis->>'ready')::boolean,false),basis->'issues' order by doc_type,fiscal_status;
select 'receivables' source,count(*) total from public.receivables union all select 'finance_movements',count(*) from public.finance_movements union all select 'receivables_payments',count(*) from public.receivables_payments union all select 'finance_fiscal_observations',count(*) from public.finance_fiscal_observations;
select d.jobid,d.status,count(*) total,max(d.end_time) latest_end from cron.job_run_details d join cron.job j using(jobid) where j.jobname in ('finance-fiscal-projection-every-minute','finance-bank-reconciliation-every-minute') and d.start_time>=now()-interval '15 minutes' group by d.jobid,d.status order by d.jobid,d.status;
