-- Derived readings never replace delivery timestamps, proof validation or signatures.
alter table public.delivery_receipts
 add column ocr_result jsonb,
 add column ocr_delivery_date date,
 add column ocr_date_confidence numeric check(ocr_date_confidence between 0 and 1),
 add column ocr_signature_presence text check(ocr_signature_presence in('present','absent','uncertain')),
 add column ocr_signature_confidence numeric check(ocr_signature_confidence between 0 and 1),
 add column ocr_requires_review boolean not null default true;
alter table public.delivery_receipt_ocr_jobs add column structured_result jsonb;

create function delivery_private.reset_receipt_reading_v1() returns trigger language plpgsql security invoker set search_path='' as $fn$
begin
 if new.processed_hash is distinct from old.processed_hash then
  new.ocr_result:=null;new.ocr_delivery_date:=null;new.ocr_date_confidence:=null;
  new.ocr_signature_presence:=null;new.ocr_signature_confidence:=null;new.ocr_requires_review:=true;
 end if;return new;
end;$fn$;
revoke all on function delivery_private.reset_receipt_reading_v1() from public,anon,authenticated,service_role;
create trigger reset_receipt_reading_v1 before update of processed_hash on public.delivery_receipts
 for each row execute function delivery_private.reset_receipt_reading_v1();

create function public.complete_delivery_receipt_ocr_v2(_job_id uuid,_lease_token uuid,_processed_hash text,_status text,_result jsonb,_error_code text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare job public.delivery_receipt_ocr_jobs%rowtype;reply jsonb;written date;match text[];y int;m int;d int;review boolean;transcription text;
begin
 if _status is null or _status not in('completed','failed','unavailable') then raise exception 'invalid_delivery_receipt_ocr_result';end if;
 if _status<>'completed' then
  if _result is not null then raise exception 'invalid_delivery_receipt_ocr_result';end if;
  reply:=public.complete_delivery_receipt_ocr_v1(_job_id,_lease_token,_processed_hash,_status,null,null,_error_code);
  if _status='failed' and reply->>'applied'='true' and reply->>'replayed'='false' then
   update public.delivery_receipt_ocr_jobs set available_at=clock_timestamp()+make_interval(secs=>least(1800,30*power(2,attempt_count-1))::int) where id=_job_id;
  end if;return reply;
 end if;
 if jsonb_typeof(_result) is distinct from 'object' or _error_code is not null
  or (select count(*) from jsonb_object_keys(_result))<>9
  or exists(select 1 from jsonb_object_keys(_result) k where k not in('text','date_text','delivery_date','date_confidence','signature_presence','signature_confidence','needs_review','provider','model'))
  or jsonb_typeof(_result->'text') is distinct from 'string' or length(_result->>'text')>8000
  or jsonb_typeof(_result->'date_text') not in('string','null') or length(_result->>'date_text')>120
  or jsonb_typeof(_result->'delivery_date') not in('string','null')
  or jsonb_typeof(_result->'date_confidence') is distinct from 'number' or (_result->>'date_confidence')::numeric not between 0 and 1
  or jsonb_typeof(_result->'signature_confidence') is distinct from 'number' or (_result->>'signature_confidence')::numeric not between 0 and 1
  or jsonb_typeof(_result->'needs_review') is distinct from 'boolean'
  or jsonb_typeof(_result->'signature_presence') is distinct from 'string' or _result->>'signature_presence' not in('present','absent','uncertain')
  or _result->>'provider' is distinct from 'lovable' or coalesce(_result->>'model','')!~'^[a-zA-Z0-9_./:-]{1,120}$'
 then raise exception 'invalid_delivery_receipt_ocr_result' using errcode='22023';end if;
 if _result->>'delivery_date' is not null then
  if (_result->>'delivery_date')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalid_delivery_receipt_ocr_date';end if;
  written:=(_result->>'delivery_date')::date;
  if coalesce(_result->>'date_text','')~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then
   if _result->>'date_text' is distinct from written::text then raise exception 'delivery_receipt_ocr_date_without_evidence';end if;
  else
   match:=regexp_match(btrim(_result->>'date_text'),'^([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]([0-9]{2}|[0-9]{4})$');
   if match is null then raise exception 'delivery_receipt_ocr_date_without_evidence';end if;
   y:=match[3]::int+case when length(match[3])=2 then 2000 else 0 end;m:=match[2]::int;d:=match[1]::int;
   if make_date(y,m,d)<>written then raise exception 'delivery_receipt_ocr_date_without_evidence';end if;
  end if;
 end if;
 review:=(_result->>'needs_review')::boolean or written is null or written>(clock_timestamp() at time zone 'UTC')::date
  or (_result->>'date_confidence')::numeric<0.85 or _result->>'signature_presence'<>'present'
  or (_result->>'signature_confidence')::numeric<0.9;
 select * into job from public.delivery_receipt_ocr_jobs where id=_job_id for update;
 if not found then raise exception 'delivery_receipt_ocr_job_not_found';end if;
 if job.status='completed' and job.structured_result is distinct from _result then raise exception 'delivery_receipt_ocr_result_conflict';end if;
 transcription:=coalesce(nullif(btrim(_result->>'text'),''),'[Leitura sem texto legível]');
 reply:=public.complete_delivery_receipt_ocr_v1(_job_id,_lease_token,_processed_hash,'completed',
  least((_result->>'date_confidence')::numeric,(_result->>'signature_confidence')::numeric),transcription,null);
 if reply->>'applied'='true' and reply->>'replayed'='false' then
  update public.delivery_receipt_ocr_jobs set structured_result=_result where id=job.id;
  update public.delivery_receipts set ocr_result=_result,ocr_delivery_date=written,ocr_date_confidence=(_result->>'date_confidence')::numeric,
   ocr_signature_presence=_result->>'signature_presence',ocr_signature_confidence=(_result->>'signature_confidence')::numeric,ocr_requires_review=review
   where id=job.receipt_id and tenant_id=job.tenant_id and is_active and processed_hash=_processed_hash;
 end if;return reply;
end;$fn$;
revoke all on function public.complete_delivery_receipt_ocr_v2(uuid,uuid,text,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.complete_delivery_receipt_ocr_v2(uuid,uuid,text,text,jsonb,text) to service_role;

create function public.get_delivery_receipt_ocr_readings_v1(_tenant_id uuid,_receipt_ids uuid[]) returns jsonb
language plpgsql stable security invoker set search_path='' as $fn$
begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'delivery_receipt_ocr_not_authorized' using errcode='42501';end if;
 if coalesce(cardinality(_receipt_ids),0) not between 1 and 100 or array_position(_receipt_ids,null) is not null then raise exception 'invalid_delivery_receipt_ocr_selection';end if;
 return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'rows',coalesce((select jsonb_agg(jsonb_build_object(
  'receipt_id',r.id,'status',r.ocr_status,'text',r.ocr_text,'date_text',r.ocr_result->>'date_text','delivery_date',r.ocr_delivery_date,
  'date_confidence',r.ocr_date_confidence,'signature_presence',r.ocr_signature_presence,'signature_confidence',r.ocr_signature_confidence,
  'needs_review',r.ocr_requires_review,'error_code',r.ocr_error_code,'updated_at',r.ocr_updated_at) order by r.id)
  from public.delivery_receipts r where r.tenant_id=_tenant_id and r.id=any(_receipt_ids) and r.is_active
   and (r.ocr_processed_hash is null or r.ocr_processed_hash=r.processed_hash)),'[]'::jsonb));
end;$fn$;
revoke all on function public.get_delivery_receipt_ocr_readings_v1(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_delivery_receipt_ocr_readings_v1(uuid,uuid[]) to authenticated;

-- Configuration starts disabled on every database, including isolated CI.
create table delivery_private.receipt_ocr_worker_config(
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,
 worker_url text check(worker_url~'^https://[a-z0-9]{20}\.supabase\.co/functions/v1/process-delivery-receipt-ocr$')
);
alter table delivery_private.receipt_ocr_worker_config enable row level security;
revoke all on delivery_private.receipt_ocr_worker_config from public,anon,authenticated,service_role;
insert into delivery_private.receipt_ocr_worker_config(singleton) values(true);
create function delivery_private.dispatch_receipt_ocr_tick_v1() returns bigint
language plpgsql security definer set search_path='' as $fn$
declare target text;cron_secret text;request_id bigint;
begin
 select worker_url into target from delivery_private.receipt_ocr_worker_config where singleton and enabled;
 if target is null then return null;end if;
 if not exists(select 1 from public.delivery_receipt_ocr_jobs where
  status in('queued','failed') and available_at<=clock_timestamp() and attempt_count<5
  or status='processing' and lease_expires_at<=clock_timestamp()) then return null;end if;
 select decrypted_secret into cron_secret from vault.decrypted_secrets where name='agvlog_cron_secret' limit 1;
 if cron_secret is null or octet_length(cron_secret)<32 then return null;end if;
 select net.http_post(url:=target,headers:=jsonb_build_object('Content-Type','application/json','x-agvlog-cron-secret',cron_secret),
  body:='{"limit":3}'::jsonb,timeout_milliseconds:=90000) into request_id;
 return request_id;
end;$fn$;
revoke all on function delivery_private.dispatch_receipt_ocr_tick_v1() from public,anon,authenticated,service_role;
do $fn$begin
 if to_regprocedure('cron.schedule(text,text,text)') is not null then
  perform cron.schedule('delivery-receipt-ocr-every-minute','* * * * *','select delivery_private.dispatch_receipt_ocr_tick_v1();');
 end if;
end;$fn$;
