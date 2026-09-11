alter table public.finance_fiscal_projection_jobs
 add column available_at timestamptz not null default clock_timestamp(),
 add column automatic_failures integer not null default 0 check(automatic_failures>=0),
 add column last_error_code text;
create index finance_fiscal_jobs_ready on public.finance_fiscal_projection_jobs(available_at,created_at,observation_id) where status='pending';

-- Invoked by the database scheduler only. No user or service API can run batches
-- across tenants. Exceptions roll back one projection, preserving other jobs.
create function finance_private.run_fiscal_queue(_limit integer default 50) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record;job public.finance_fiscal_projection_jobs%rowtype;outcome jsonb;
 handled integer:=0;deferred integer:=0;failed integer:=0;error_code text;started timestamptz:=clock_timestamp();
begin
 if auth.uid() is not null then raise exception 'finance_system_worker_only' using errcode='42501';end if;
 if _limit is null or _limit<1 or _limit>100 then raise exception 'finance_invalid_batch_limit' using errcode='22023';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('finance:fiscal-queue-worker',0)) then
  return jsonb_build_object('handled',0,'deferred',0,'failed',0,'busy',true);end if;
 for candidate in select j.observation_id,j.tenant_id from public.finance_fiscal_projection_jobs j
  join public.finance_fiscal_observations o on o.id=j.observation_id and o.tenant_id=j.tenant_id
  where j.status='pending' and j.available_at<=started
  order by j.available_at,o.observed_order limit _limit
 loop
  exit when clock_timestamp()-started>interval '20 seconds';
  -- Same lock order as manual projection and receipt commands; skip busy tenants.
  if not pg_try_advisory_xact_lock(hashtextextended('fiscal:'||candidate.tenant_id::text,0))
   or not pg_try_advisory_xact_lock(hashtextextended(candidate.tenant_id::text||':finance',0)) then
   deferred:=deferred+1;continue;end if;
  select * into job from public.finance_fiscal_projection_jobs
   where observation_id=candidate.observation_id and tenant_id=candidate.tenant_id and status='pending'
    and available_at<=started for update skip locked;
  if not found then deferred:=deferred+1;continue;end if;
  begin
   outcome:=finance_private.process_fiscal_observation(job.tenant_id,job.observation_id);
   handled:=handled+1;
   update public.finance_fiscal_projection_jobs set last_error_code=null where observation_id=job.observation_id;
  exception when others then
   get stacked diagnostics error_code=returned_sqlstate;
   failed:=failed+1;
   update public.finance_fiscal_projection_jobs set automatic_failures=automatic_failures+1,attempts=attempts+1,
    status=case when automatic_failures>=4 then 'review' else 'pending' end,
    issue=case when automatic_failures>=4 then 'automatic_projection_failed' else 'automatic_projection_retry' end,
    last_error_code=error_code,available_at=clock_timestamp()+make_interval(secs=>30*power(2,least(automatic_failures,6))::integer),updated_at=clock_timestamp()
   where observation_id=job.observation_id;
   insert into public.finance_fiscal_projection_events(tenant_id,observation_id,actor_id,action,after_data)
   values(job.tenant_id,job.observation_id,null,'automatic_projection_failure',
    jsonb_build_object('error_code',error_code,'attempt',job.automatic_failures+1,'requires_review',job.automatic_failures>=4));
  end;
 end loop;
 return jsonb_build_object('handled',handled,'deferred',deferred,'failed',failed,'busy',false);
end;$$;
revoke all on function finance_private.run_fiscal_queue(integer) from public,anon,authenticated,service_role;

create function finance_private.list_fiscal_queue(_tenant uuid,_status text,_page integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;total bigint;counts jsonb;scheduler_active boolean:=false;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _status is null or _status not in('','pending','review','applied','superseded') or _page is null or _page<1 or _page>1000000 then
  raise exception 'finance_invalid_filters' using errcode='22023';end if;
 select jsonb_build_object('pending',count(*) filter(where status='pending'),'review',count(*) filter(where status='review'),
  'applied',count(*) filter(where status='applied'),'superseded',count(*) filter(where status='superseded')) into counts
 from public.finance_fiscal_projection_jobs where tenant_id=_tenant;
 select count(*) into total from public.finance_fiscal_projection_jobs where tenant_id=_tenant and (_status='' or status=_status);
 select coalesce(jsonb_agg(row_data order by observed_order desc),'[]') into rows from (
  select o.observed_order,jsonb_build_object('observation_id',j.observation_id,'tenant_id',j.tenant_id,'status',j.status,
   'document_type',o.snapshot->>'doc_type','document_number',o.snapshot->>'number','fiscal_status',o.snapshot->>'status',
   'attempts',j.attempts,'automatic_failures',j.automatic_failures,'issue',j.issue,'available_at',j.available_at,
   'created_at',j.created_at,'updated_at',j.updated_at,'receivable_id',j.result->>'receivable_id') row_data
  from public.finance_fiscal_projection_jobs j join public.finance_fiscal_observations o on o.id=j.observation_id and o.tenant_id=j.tenant_id
  where j.tenant_id=_tenant and (_status='' or j.status=_status)
  order by o.observed_order desc limit 30 offset (_page-1)*30
 ) entries;
 if to_regclass('cron.job') is not null then
  execute $query$select exists(select 1 from cron.job where jobname='finance-fiscal-projection-every-minute' and active
   and command='SET statement_timeout = ''25s''; SELECT finance_private.run_fiscal_queue(50);')$query$ into scheduler_active;
 end if;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'page',_page,'page_size',30,'status_filter',_status,'total',total,
  'counts',counts,'scheduler_active',scheduler_active,'rows',rows);
end;$$;
revoke all on function finance_private.list_fiscal_queue(uuid,text,integer) from public,anon,authenticated,service_role;
create function public.list_finance_fiscal_queue(_tenant_id uuid,_status text default '',_page integer default 1) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.list_fiscal_queue(_tenant_id,_status,_page);$$;
revoke all on function public.list_finance_fiscal_queue(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_finance_fiscal_queue(uuid,text,integer),finance_private.list_fiscal_queue(uuid,text,integer) to authenticated;

-- pg_cron is absent in some test/local databases. The dedicated bootstrap can
-- register this same named job once the extension is available.
do $schedule$
begin
 if to_regprocedure('cron.schedule(text,text,text)') is not null then
  execute $sql$select cron.schedule('finance-fiscal-projection-every-minute','* * * * *',
   'SET statement_timeout = ''25s''; SELECT finance_private.run_fiscal_queue(50);')$sql$;
 else
  raise notice 'Finance fiscal worker requires pg_cron; run supabase/bootstrap/finance_fiscal_worker.sql after enabling it.';
 end if;
end;
$schedule$;
