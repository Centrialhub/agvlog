-- OCR orchestration only. No provider or external egress is configured here.
alter table public.delivery_receipts
 add column ocr_status text not null default 'not_requested' check(ocr_status in('not_requested','queued','processing','completed','failed','unavailable')),
 add column ocr_confidence numeric check(ocr_confidence between 0 and 1),
 add column ocr_text text check(length(ocr_text)<=50000),
 add column ocr_processed_hash text check(ocr_processed_hash is null or ocr_processed_hash~'^[a-f0-9]{64}$'),
 add column ocr_error_code text check(ocr_error_code is null or ocr_error_code~'^[a-z0-9_]{3,80}$'),
 add column ocr_updated_at timestamptz;
create index delivery_receipts_ocr_queue_idx on public.delivery_receipts(tenant_id,ocr_status,updated_at,id);
create index delivery_receipts_ocr_text_idx on public.delivery_receipts using gin(to_tsvector('simple',coalesce(ocr_text,'')));

create table public.delivery_receipt_ocr_jobs(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,receipt_id uuid not null,processed_hash text not null check(processed_hash~'^[a-f0-9]{64}$'),
 source_path text not null check(position('..' in source_path)=0 and position(E'\\' in source_path)=0),
 status text not null default 'queued' check(status in('queued','processing','completed','failed','unavailable','superseded')),
 attempt_count integer not null default 0 check(attempt_count between 0 and 20),available_at timestamptz not null default clock_timestamp(),
 lease_token uuid,lease_expires_at timestamptz,result_fingerprint text check(result_fingerprint is null or result_fingerprint~'^[a-f0-9]{64}$'),
 confidence numeric check(confidence between 0 and 1),extracted_text text check(length(extracted_text)<=50000),error_code text,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),completed_at timestamptz,
 unique(tenant_id,receipt_id,processed_hash),foreign key(tenant_id,receipt_id) references public.delivery_receipts(tenant_id,id) on delete cascade,
 check((lease_token is null and lease_expires_at is null) or (lease_token is not null and lease_expires_at is not null))
);
create index delivery_receipt_ocr_jobs_claim_idx on public.delivery_receipt_ocr_jobs(status,available_at,lease_expires_at,created_at,id);
alter table public.delivery_receipt_ocr_jobs enable row level security;
revoke all on table public.delivery_receipt_ocr_jobs from public,anon,authenticated,service_role;

create schema if not exists delivery_private;
revoke all on schema delivery_private from public,anon,authenticated,service_role;
create function delivery_private.queue_receipt_ocr() returns trigger language plpgsql security definer set search_path=''
as $function$begin
 if new.processed_path is null or coalesce(new.processed_hash,'')!~'^[a-f0-9]{64}$' then return new;end if;
 update public.delivery_receipt_ocr_jobs set status='superseded',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp()
  where tenant_id=new.tenant_id and receipt_id=new.id and processed_hash<>new.processed_hash and status in('queued','processing','failed');
 insert into public.delivery_receipt_ocr_jobs(tenant_id,receipt_id,processed_hash,source_path)
  values(new.tenant_id,new.id,new.processed_hash,new.processed_path) on conflict(tenant_id,receipt_id,processed_hash) do nothing;
 update public.delivery_receipts set ocr_status='queued',ocr_confidence=null,ocr_text=null,ocr_processed_hash=new.processed_hash,
  ocr_error_code=null,ocr_updated_at=clock_timestamp() where tenant_id=new.tenant_id and id=new.id and ocr_processed_hash is distinct from new.processed_hash;
 return new;end;$function$;
revoke all on function delivery_private.queue_receipt_ocr() from public,anon,authenticated,service_role;
create trigger queue_delivery_receipt_ocr after insert or update of processed_hash,processed_path on public.delivery_receipts
 for each row execute function delivery_private.queue_receipt_ocr();

insert into public.delivery_receipt_ocr_jobs(tenant_id,receipt_id,processed_hash,source_path)
 select tenant_id,id,processed_hash,processed_path from public.delivery_receipts
 where processed_path is not null and processed_hash~'^[a-f0-9]{64}$' on conflict do nothing;
update public.delivery_receipts set ocr_status='queued',ocr_processed_hash=processed_hash,ocr_updated_at=clock_timestamp()
 where processed_path is not null and processed_hash~'^[a-f0-9]{64}$' and ocr_status='not_requested';

create function public.claim_delivery_receipt_ocr_v1() returns jsonb language plpgsql security definer set search_path=''
as $function$declare job public.delivery_receipt_ocr_jobs%rowtype;token uuid;begin
 select * into job from public.delivery_receipt_ocr_jobs where
  (status='queued' and available_at<=clock_timestamp()) or
  (status='failed' and attempt_count<5 and available_at<=clock_timestamp()) or
  (status='processing' and lease_expires_at<=clock_timestamp())
 order by available_at,created_at,id for update skip locked limit 1;
 if not found then return jsonb_build_object('version',1,'status','empty');end if;
 token:=gen_random_uuid();update public.delivery_receipt_ocr_jobs set status='processing',attempt_count=attempt_count+1,lease_token=token,
  lease_expires_at=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp() where id=job.id returning * into job;
 update public.delivery_receipts set ocr_status='processing',ocr_updated_at=clock_timestamp() where id=job.receipt_id and tenant_id=job.tenant_id
  and processed_hash=job.processed_hash;
 return jsonb_build_object('version',1,'status','claimed','job_id',job.id,'tenant_id',job.tenant_id,'receipt_id',job.receipt_id,
  'processed_hash',job.processed_hash,'bucket','receipts','path',job.source_path,'lease_token',job.lease_token,'lease_expires_at',job.lease_expires_at);
end;$function$;
revoke all on function public.claim_delivery_receipt_ocr_v1() from public,anon,authenticated,service_role;
grant execute on function public.claim_delivery_receipt_ocr_v1() to service_role;

create function public.complete_delivery_receipt_ocr_v1(_job_id uuid,_lease_token uuid,_processed_hash text,_status text,
 _confidence numeric,_text text,_error_code text) returns jsonb language plpgsql security definer set search_path=''
as $function$declare job public.delivery_receipt_ocr_jobs%rowtype;receipt public.delivery_receipts%rowtype;fingerprint text;begin
 if _status not in('completed','failed','unavailable') or coalesce(_processed_hash,'')!~'^[a-f0-9]{64}$'
  or (_status='completed' and (_confidence is null or _confidence not between 0 and 1 or length(coalesce(_text,''))<1 or length(_text)>50000 or _error_code is not null))
  or (_status<>'completed' and (_confidence is not null or _text is not null or coalesce(_error_code,'')!~'^[a-z0-9_]{3,80}$')) then
  raise exception 'invalid_delivery_receipt_ocr_result' using errcode='22023';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('processed_hash',_processed_hash,'status',_status,'confidence',_confidence,
  'text',_text,'error_code',_error_code)::text,'UTF8')),'hex');
 select * into job from public.delivery_receipt_ocr_jobs where id=_job_id for update;
 if not found then raise exception 'delivery_receipt_ocr_job_not_found' using errcode='P0002';end if;
 select * into receipt from public.delivery_receipts where id=job.receipt_id and tenant_id=job.tenant_id for update;
 if not found or not receipt.is_active or receipt.processed_hash is distinct from _processed_hash or job.processed_hash is distinct from _processed_hash then
  update public.delivery_receipt_ocr_jobs set status='superseded',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=job.id;
  return jsonb_build_object('version',1,'job_id',job.id,'receipt_id',job.receipt_id,'status','superseded','applied',false,'replayed',false);end if;
 if job.status in('completed','failed','unavailable') then
  if job.result_fingerprint is distinct from fingerprint then raise exception 'delivery_receipt_ocr_result_conflict' using errcode='23514';end if;
  return jsonb_build_object('version',1,'job_id',job.id,'receipt_id',job.receipt_id,'status',job.status,'applied',true,'replayed',true);end if;
 if job.status<>'processing' or job.lease_token is distinct from _lease_token or job.lease_expires_at<=clock_timestamp() then
  raise exception 'delivery_receipt_ocr_lease_invalid' using errcode='23514';end if;
 update public.delivery_receipt_ocr_jobs set status=_status,result_fingerprint=fingerprint,confidence=_confidence,extracted_text=_text,
  error_code=_error_code,lease_token=null,lease_expires_at=null,completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=job.id;
 update public.delivery_receipts set ocr_status=_status,ocr_confidence=_confidence,ocr_text=_text,ocr_processed_hash=_processed_hash,
  ocr_error_code=_error_code,ocr_updated_at=clock_timestamp() where id=receipt.id and tenant_id=receipt.tenant_id;
 perform public._log_entity_audit(receipt.tenant_id,'delivery_receipt',receipt.id,'ocr_'||_status,null,
  jsonb_build_object('job_id',job.id,'processed_hash',_processed_hash,'confidence',_confidence,'error_code',_error_code),'complete_delivery_receipt_ocr_v1');
 return jsonb_build_object('version',1,'job_id',job.id,'receipt_id',job.receipt_id,'status',_status,'applied',true,'replayed',false);
end;$function$;
revoke all on function public.complete_delivery_receipt_ocr_v1(uuid,uuid,text,text,numeric,text,text) from public,anon,authenticated,service_role;
grant execute on function public.complete_delivery_receipt_ocr_v1(uuid,uuid,text,text,numeric,text,text) to service_role;

create function public.get_delivery_receipt_ocr_health_v1(_tenant_id uuid) returns jsonb language plpgsql stable security definer set search_path=''
as $function$begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'delivery_receipt_ocr_not_authorized' using errcode='42501';end if;
 return (select jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'queued',count(*) filter(where ocr_status='queued'),
  'processing',count(*) filter(where ocr_status='processing'),'completed',count(*) filter(where ocr_status='completed'),
  'failed',count(*) filter(where ocr_status='failed'),'unavailable',count(*) filter(where ocr_status='unavailable'),
  'low_confidence',count(*) filter(where ocr_status='completed' and ocr_confidence<0.75)) from public.delivery_receipts where tenant_id=_tenant_id and is_active);
end;$function$;
revoke all on function public.get_delivery_receipt_ocr_health_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_delivery_receipt_ocr_health_v1(uuid) to authenticated;

create function public.search_delivery_receipt_ocr_v1(_tenant_id uuid,_query text,_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path=''
as $function$declare rows jsonb;begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'delivery_receipt_ocr_not_authorized' using errcode='42501';end if;
 if length(btrim(coalesce(_query,''))) not between 2 and 200 or _limit not between 1 and 100 then raise exception 'invalid_delivery_receipt_ocr_search' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('receipt_id',receipt.id,'status',receipt.ocr_status,'confidence',receipt.ocr_confidence,
  'text',left(receipt.ocr_text,1000),'processed_hash',receipt.ocr_processed_hash,'updated_at',receipt.ocr_updated_at)
  order by receipt.delivered_at desc,receipt.id desc),'[]'::jsonb) into rows from(
   select * from public.delivery_receipts where tenant_id=_tenant_id and is_active and ocr_status='completed'
    and to_tsvector('simple',coalesce(ocr_text,''))@@plainto_tsquery('simple',btrim(_query)) order by delivered_at desc,id desc limit _limit) receipt;
 return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'rows',rows);
end;$function$;
revoke all on function public.search_delivery_receipt_ocr_v1(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.search_delivery_receipt_ocr_v1(uuid,text,integer) to authenticated;

comment on table public.delivery_receipt_ocr_jobs is 'Hash-bound OCR work queue. Results are applied only while the active receipt still has the claimed processed_hash.';
