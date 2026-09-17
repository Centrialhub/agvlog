-- Explicit production action; not part of fresh schema chain. Never invokes a worker.
set local lock_timeout='3s';set local statement_timeout='30s';
-- Serialize only this administrative action; use the supported Cron API for mutation.
do $resume$
declare spec record;routine record;job record;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('finance_known_workers_resume',0)) then raise exception using errcode='40001',message='finance_worker_resume_busy';end if;
 if to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') is null then raise exception 'finance_cron_alter_job_missing';end if;
 if not coalesce(finance_private.account_period_guards_ready(),false) or not coalesce((finance_private.movement_correction_readiness()->>'ready')::boolean,false) then raise exception 'finance_worker_runtime_not_ready';end if;
 if exists(select 1 from pg_proc where oid='finance_private.can_access(uuid)'::regprocedure and regexp_replace(lower(prosrc),'\s','','g')='selectfalse;') then raise exception 'finance_workers_require_core_activation';end if;
 for spec in select * from(values
 ('finance_private.run_fiscal_queue(integer)','d58da437d5255c9ab32757ffd8eb8c49'),
 ('finance_private.process_fiscal_observation(uuid,uuid)','e4debeb8b03f4c384546ee81607857ee'),
 ('finance_private.run_automatic_reconciliation_queue()','3e4e9bcba2520f0af941dff5a29c7b2a'),
 ('finance_private.process_automatic_reconciliation(uuid)','603136435ca4542ec7b0c4741e0932b5')
 ) signatures(signature,source_hash) loop
 select p.* into routine from pg_proc p where p.oid=to_regprocedure(spec.signature);
 if not found then raise exception 'finance_worker_function_missing: %',spec.signature;end if;
 if md5(replace(routine.prosrc,E'\r\n',E'\n'))<>spec.source_hash or not routine.prosecdef or routine.proconfig is distinct from array['search_path=""']::text[]
 or exists(select 1 from aclexplode(coalesce(routine.proacl,acldefault('f',routine.proowner))) acl where acl.privilege_type='EXECUTE' and acl.grantee<>routine.proowner)
 then raise exception 'finance_worker_function_changed: %',spec.signature;end if;
 end loop;
 for spec in select * from(values
 ('finance-fiscal-projection-every-minute',$job$SET statement_timeout = '25s'; SELECT finance_private.run_fiscal_queue(50);$job$),
 ('finance-bank-reconciliation-every-minute',$job$SET statement_timeout = '25s'; SELECT finance_private.run_automatic_reconciliation_queue();$job$)
 ) jobs(name,command) loop
 if (select count(*) from cron.job where jobname=spec.name)<>1 then raise exception 'finance_worker_job_missing_or_duplicate: %',spec.name;end if;
 select * into job from cron.job where jobname=spec.name;
 if job.command is distinct from spec.command or job.schedule is distinct from '* * * * *' or job.database is distinct from 'postgres' or job.username is distinct from 'postgres' then raise exception 'finance_worker_job_changed: %',spec.name;end if;
 end loop;
 -- All definitions were validated before the first mutation; retries are no-ops.
 for job in select jobid,active from cron.job where jobname in('finance-fiscal-projection-every-minute','finance-bank-reconciliation-every-minute') order by jobid loop
 if not job.active then perform cron.alter_job(job_id:=job.jobid,active:=true);end if;
 end loop;
 for spec in select * from(values
 ('finance-fiscal-projection-every-minute',$job$SET statement_timeout = '25s'; SELECT finance_private.run_fiscal_queue(50);$job$),
 ('finance-bank-reconciliation-every-minute',$job$SET statement_timeout = '25s'; SELECT finance_private.run_automatic_reconciliation_queue();$job$)
 ) jobs(name,command) loop
 if (select count(*) from cron.job where jobname=spec.name)<>1 then raise exception 'finance_worker_job_missing_or_duplicate: %',spec.name;end if;
 select * into job from cron.job where jobname=spec.name;
 if job.command is distinct from spec.command or job.schedule is distinct from '* * * * *' or job.database is distinct from 'postgres' or job.username is distinct from 'postgres' then raise exception 'finance_worker_job_changed: %',spec.name;end if;
 end loop;
 if (select count(*) from cron.job where jobname in('finance-fiscal-projection-every-minute','finance-bank-reconciliation-every-minute') and active)<>2 then raise exception 'finance_worker_resume_postcondition_failed';end if;
end;$resume$;
