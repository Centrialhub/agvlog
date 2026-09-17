-- SELECT-only; requires pg_cron. Contains no schedule/alter_job/run invocation.
select jobid,jobname,schedule,active,database,username,command
from cron.job
where jobname in('finance-fiscal-projection-every-minute','finance-bank-reconciliation-every-minute')
order by jobname,jobid;
-- Only operational metadata, never file contents or customer document payloads.
select j.jobname,d.status,d.return_message,d.start_time,d.end_time
from cron.job_run_details d join cron.job j on j.jobid=d.jobid
where j.jobname in('finance-fiscal-projection-every-minute','finance-bank-reconciliation-every-minute')
order by d.start_time desc limit 10;
