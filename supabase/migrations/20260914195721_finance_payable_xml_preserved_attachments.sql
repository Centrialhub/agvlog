-- Candidate: isolated XML preservation for payables. No fiscal issuance, scanner claim or money movement.
create schema if not exists payable_xml_private;
revoke all on schema payable_xml_private from public,anon,authenticated,service_role;
grant usage on schema payable_xml_private to authenticated,service_role;
create table payable_xml_private.artifacts(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),actor_id uuid not null references auth.users(id),request_id uuid not null,
 sha256 text not null check(sha256~'^[a-f0-9]{64}$'),size_bytes int not null check(size_bytes between 1 and 2000000),
 ticket uuid not null default gen_random_uuid(),expires_at timestamptz not null,authorization_revision text not null,
 received boolean not null default false,summary jsonb,created_at timestamptz not null default clock_timestamp(),unique(tenant_id,actor_id,request_id));
create table payable_xml_private.commands(tenant_id uuid not null,actor_id uuid not null,request_id uuid not null,payload jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(tenant_id,actor_id,request_id));
create table payable_xml_private.links(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,payable_id uuid not null references public.payables(id),artifact_id uuid not null references payable_xml_private.artifacts(id),actor_id uuid not null,request_id uuid not null,created_at timestamptz not null default clock_timestamp(),unique(tenant_id,artifact_id));
create index payable_xml_artifacts_tenant_sha on payable_xml_private.artifacts(tenant_id,sha256);
create index payable_xml_artifacts_tenant_nfe on payable_xml_private.artifacts(tenant_id,(summary->>'access_key'));
create index payable_xml_links_context on payable_xml_private.links(tenant_id,payable_id,created_at desc,id);
alter table payable_xml_private.artifacts enable row level security;alter table payable_xml_private.commands enable row level security;alter table payable_xml_private.links enable row level security;
revoke all on all tables in schema payable_xml_private from public,anon,authenticated,service_role;
create function payable_xml_private.authorize(t uuid) returns void language plpgsql security definer set search_path='' set statement_timeout='15s' set lock_timeout='3s' as $$begin
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=auth.uid() order by role::text for share;
 perform 1 from public.drivers where tenant_id=t and user_id=auth.uid() order by id for share;
 perform finance_private.require_access(t);if private.request_tenant_id() is distinct from t or auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(t),false) then raise exception 'finance_access_denied' using errcode='42501';end if;
end$$;
create function payable_xml_private.dto(a payable_xml_private.artifacts) returns jsonb language sql stable set search_path='' as $$select jsonb_build_object('version',1,'tenant_id',a.tenant_id,'actor_id',a.actor_id,'request_id',a.request_id,'artifact_id',a.id,'sha256',a.sha256,'size_bytes',a.size_bytes,'state',case when a.received then 'original_quarantined' else 'reserved' end,'summary',a.summary,'signature_verified',false,'antivirus_verified',false)$$;
create function payable_xml_private.reserve(p jsonb) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='15s' set lock_timeout='3s' as $$
declare t uuid:=(p->>'tenant_id')::uuid;r uuid:=(p->>'request_id')::uuid;a payable_xml_private.artifacts;
begin perform payable_xml_private.authorize(t);
 perform pg_advisory_xact_lock(hashtextextended('payable-xml-quota:'||t::text||auth.uid()::text,0));
 if p->>'version' is distinct from '1' or r is null or not coalesce((p->>'sha256')~'^[a-f0-9]{64}$',false) or not coalesce((p->>'size_bytes')::int between 1 and 2000000,false) or exists(select 1 from jsonb_object_keys(p) k where k<>all(array['version','tenant_id','request_id','sha256','size_bytes'])) then raise exception 'payable_xml_invalid_request' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||auth.uid()::text||r::text,0));perform payable_xml_private.authorize(t);
 select * into a from payable_xml_private.artifacts where tenant_id=t and actor_id=auth.uid() and request_id=r for update;
 if a.id is not null then if a.sha256 is distinct from p->>'sha256' or a.size_bytes is distinct from (p->>'size_bytes')::int then raise exception 'payable_xml_request_conflict' using errcode='22023';end if;
  if not a.received then update payable_xml_private.artifacts set expires_at=clock_timestamp()+interval '2 minutes',authorization_revision=secure_upload_private.authorization_revision() where id=a.id returning * into a;end if;
 else
  if (select count(*) from payable_xml_private.artifacts where tenant_id=t and actor_id=auth.uid() and created_at>clock_timestamp()-interval '1 hour')>=60 then raise exception 'payable_xml_upload_rate_limited' using errcode='55000';end if;
  insert into payable_xml_private.artifacts(tenant_id,actor_id,request_id,sha256,size_bytes,expires_at,authorization_revision) values(t,auth.uid(),r,p->>'sha256',(p->>'size_bytes')::int,clock_timestamp()+interval '2 minutes',secure_upload_private.authorization_revision()) returning * into a;
 end if;return payable_xml_private.dto(a);end$$;
create function payable_xml_private.service_authorize(a payable_xml_private.artifacts) returns void language plpgsql security definer set search_path='' set statement_timeout='15s' set lock_timeout='3s' as $$begin
 if a.expires_at<=clock_timestamp() or a.authorization_revision is distinct from secure_upload_private.authorization_revision() then raise exception 'payable_xml_authorization_expired' using errcode='42501';end if;
 perform 1 from public.tenant_memberships where tenant_id=a.tenant_id and user_id=a.actor_id order by role::text for share nowait;
 perform 1 from public.drivers where tenant_id=a.tenant_id and user_id=a.actor_id order by id for share nowait;
 if not exists(select 1 from public.tenant_memberships where tenant_id=a.tenant_id and user_id=a.actor_id and active and role::text in('owner','admin','operator')) or exists(select 1 from public.tenant_memberships where tenant_id=a.tenant_id and user_id=a.actor_id and active and role::text='driver') or exists(select 1 from public.drivers where tenant_id=a.tenant_id and user_id=a.actor_id and active) or not exists(select 1 from auth.users where id=a.actor_id) then raise exception 'finance_access_denied' using errcode='42501';end if;
end$$;
create function payable_xml_private.prepare(t uuid,actor uuid,artifact uuid) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='15s' set lock_timeout='3s' as $$declare a payable_xml_private.artifacts;begin
 select * into a from payable_xml_private.artifacts where id=artifact and tenant_id=t and actor_id=actor for update;if a.id is null then raise exception 'payable_xml_not_found' using errcode='42501';end if;perform payable_xml_private.service_authorize(a);
 return jsonb_build_object('artifact',payable_xml_private.dto(a),'ticket',a.ticket,'bucket','payable-xml-quarantine','path',a.tenant_id::text||'/'||a.actor_id::text||'/'||a.request_id::text||'/original');end$$;
create function payable_xml_private.finish(p jsonb) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='15s' set lock_timeout='3s' as $$declare a payable_xml_private.artifacts;s jsonb:=p->'summary';o storage.objects;begin
 select * into a from payable_xml_private.artifacts where id=(p->>'artifact_id')::uuid for update;if a.id is null or a.ticket is distinct from (p->>'ticket')::uuid then raise exception 'payable_xml_not_found' using errcode='42501';end if;perform payable_xml_private.service_authorize(a);
 if exists(select 1 from jsonb_object_keys(p) k where k<>all(array['artifact_id','ticket','summary'])) or s->>'kind' is distinct from 'nfe' or s->>'signature_verified' is distinct from 'false' or s->>'antivirus_verified' is distinct from 'false' or not coalesce((s->>'amount_cents')~'^[1-9][0-9]{0,13}$',false) or not coalesce((s->>'access_key')~'^[0-9]{44}$',false) or jsonb_typeof(s) is distinct from 'object' or nullif(btrim(s->>'emitter_name'),'') is null or not coalesce(s->>'emitter_document'~'^([0-9]{11}|[0-9]{14})$',false) or not coalesce(s->>'document_number'~'^[0-9]{1,9}$',false) or not coalesce(s->>'series'~'^[0-9]{1,3}$',false) or not coalesce(s->>'issue_date'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$',false) or exists(select 1 from jsonb_object_keys(s) k where k<>all(array['kind','emitter_name','emitter_document','document_number','series','access_key','issue_date','amount_cents','signature_verified','antivirus_verified'])) or length(s::text)>20000 then raise exception 'payable_xml_invalid_summary' using errcode='22023';end if;
 select * into o from storage.objects where bucket_id='payable-xml-quarantine' and name=a.tenant_id::text||'/'||a.actor_id::text||'/'||a.request_id::text||'/original' for share;
 if o.id is null or o.metadata->>'mimetype' is distinct from 'application/octet-stream' or (o.metadata->>'size')::bigint is distinct from a.size_bytes or o.user_metadata->>'sha256' is distinct from a.sha256 or o.user_metadata->>'artifact_id' is distinct from a.id::text or o.user_metadata->>'kind' is distinct from 'quarantined_payable_xml' or o.user_metadata->>'size_bytes' is distinct from a.size_bytes::text then raise exception 'payable_xml_storage_mismatch' using errcode='55000';end if;
 if a.received then if a.summary is distinct from s then raise exception 'payable_xml_request_conflict' using errcode='22023';end if;return payable_xml_private.dto(a);end if;
 update payable_xml_private.artifacts set received=true,summary=s where id=a.id returning * into a;return payable_xml_private.dto(a);end$$;
create function payable_xml_private.record(p jsonb) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='15s' set lock_timeout='3s' as $$
declare t uuid:=(p->>'tenant_id')::uuid;r uuid:=(p->>'request_id')::uuid;a payable_xml_private.artifacts;old public.payables;result jsonb;cmd payable_xml_private.commands;f jsonb:=p->'fields';pid uuid:=(p->>'payable_id')::uuid;link uuid;
begin perform payable_xml_private.authorize(t);
 if p->>'version' is distinct from '1' or r is null or jsonb_typeof(f) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p) k where k<>all(array['version','tenant_id','request_id','artifact_id','payable_id','expected_revision','fields'])) or exists(select 1 from jsonb_object_keys(f) k where k<>all(array['supplier_name','category','description','amount_cents','due_date','competence_date','document_number','status','notes'])) or nullif(btrim(f->>'supplier_name'),'') is null or not coalesce((f->>'amount_cents')~'^[1-9][0-9]{0,13}$',false) or coalesce(f->>'status','pending') not in('pending','overdue','cancelled','approved','paid') then raise exception 'payable_xml_invalid_command' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||auth.uid()::text||r::text,0));perform payable_xml_private.authorize(t);
 select * into cmd from payable_xml_private.commands where tenant_id=t and actor_id=auth.uid() and request_id=r;if found then perform payable_xml_private.authorize(t);if cmd.payload is distinct from p then raise exception 'payable_xml_request_conflict' using errcode='22023';end if;return cmd.result;end if;
 select * into a from payable_xml_private.artifacts where id=(p->>'artifact_id')::uuid and tenant_id=t and actor_id=auth.uid() for update;
 perform payable_xml_private.authorize(t);if a.id is null or not a.received then raise exception 'payable_xml_original_not_preserved' using errcode='55000';end if;
 if exists(select 1 from payable_xml_private.links where tenant_id=t and artifact_id=a.id) then raise exception 'payable_xml_already_linked' using errcode='55000';end if;
 perform pg_advisory_xact_lock(hashtextextended('payable-xml-sha:'||t::text||a.sha256,0));
 perform pg_advisory_xact_lock(hashtextextended('payable-xml-nfe:'||t::text||(a.summary->>'access_key'),0));
 perform payable_xml_private.authorize(t);
 perform 1 from payable_xml_private.links l join payable_xml_private.artifacts previous on previous.id=l.artifact_id join public.payables existing on existing.id=l.payable_id and existing.tenant_id=t where l.tenant_id=t and (previous.sha256=a.sha256 or previous.summary->>'access_key'=a.summary->>'access_key') order by existing.id for share of existing;
 if exists(select 1 from payable_xml_private.links l join payable_xml_private.artifacts previous on previous.id=l.artifact_id join public.payables existing on existing.id=l.payable_id and existing.tenant_id=t where l.tenant_id=t and existing.status<>'cancelled' and existing.id is distinct from pid and (previous.sha256=a.sha256 or previous.summary->>'access_key'=a.summary->>'access_key')) then raise exception 'payable_xml_already_registered' using errcode='55000';end if;

 if pid is not null then
  select * into old from public.payables where id=pid and tenant_id=t for update;perform payable_xml_private.authorize(t);if old.id is null then raise exception 'payable_xml_not_found' using errcode='42501';end if;
  if md5(to_jsonb(old)::text) is distinct from p->>'expected_revision' then raise exception 'payable_xml_changed' using errcode='40001';end if;
  if f->>'status' in('approved','paid') and f->>'status' is distinct from old.status then raise exception 'payable_xml_status_requires_command' using errcode='55000';end if;
  update public.payables set supplier_name=btrim(f->>'supplier_name'),category=f->>'category',description=f->>'description',amount=(f->>'amount_cents')::numeric/100,due_date=(f->>'due_date')::date,competence_date=(f->>'competence_date')::date,document_number=f->>'document_number',status=coalesce(f->>'status','pending'),notes=f->>'notes',updated_at=clock_timestamp() where id=pid and tenant_id=t;
 else
  if p->>'expected_revision' is not null or f->>'status' in('approved','paid') then raise exception 'payable_xml_status_requires_command' using errcode='55000';end if;
  insert into public.payables(tenant_id,created_by,supplier_name,category,description,amount,due_date,competence_date,document_number,status,notes) values(t,auth.uid(),btrim(f->>'supplier_name'),f->>'category',f->>'description',(f->>'amount_cents')::numeric/100,(f->>'due_date')::date,(f->>'competence_date')::date,f->>'document_number',coalesce(f->>'status','pending'),f->>'notes') returning id into pid;
 end if;
 perform payable_xml_private.authorize(t);
 insert into payable_xml_private.links(tenant_id,payable_id,artifact_id,actor_id,request_id) values(t,pid,a.id,auth.uid(),r) returning id into link;
 result:=jsonb_build_object('version',1,'confirmed',true,'tenant_id',t,'actor_id',auth.uid(),'request_id',r,'payable_id',pid,'artifact_id',a.id,'link_id',link,'amount_cents',f->>'amount_cents','original_preserved',true,'cash_changed',false,'fiscal_document_created',false);
 insert into payable_xml_private.commands values(t,auth.uid(),r,p,result,clock_timestamp());return result;end$$;
create function payable_xml_private.context(t uuid,pid uuid,offset_value int,expected_history_revision text) returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='15s' set lock_timeout='3s' as $$declare p public.payables;rows jsonb;n bigint;history_revision text;begin
 perform payable_xml_private.authorize(t);if offset_value<0 then raise exception 'payable_xml_invalid_page' using errcode='22023';end if;
 select * into p from public.payables where id=pid and tenant_id=t;if p.id is null then raise exception 'payable_xml_not_found' using errcode='42501';end if;
 select count(*),md5(coalesce(string_agg(id::text,'|' order by created_at desc,id),'')) into n,history_revision from payable_xml_private.links where tenant_id=t and payable_id=pid;
 if (offset_value>0 and expected_history_revision is null) or (expected_history_revision is not null and expected_history_revision<>history_revision) then raise exception 'payable_xml_history_changed' using errcode='40001';end if;
 select coalesce(jsonb_agg(v order by created_at desc,id),'[]') into rows from(select l.id,l.created_at,jsonb_build_object('link_id',l.id,'created_at',l.created_at,'actor_id',l.actor_id,'artifact',payable_xml_private.dto(a)) v from payable_xml_private.links l join payable_xml_private.artifacts a on a.id=l.artifact_id where l.tenant_id=t and l.payable_id=pid order by l.created_at desc,l.id offset offset_value limit 50) q;
 return jsonb_build_object('version',1,'tenant_id',t,'actor_id',auth.uid(),'payable_id',pid,'revision',md5(to_jsonb(p)::text),'payable',to_jsonb(p),'history_revision',history_revision,'offset',offset_value,'total',n,'next_offset',case when offset_value+50<n then offset_value+50 end,'rows',rows);end$$;
create function payable_xml_private.preserve() returns trigger language plpgsql set search_path='' as $$begin raise exception 'payable_xml_immutable' using errcode='55000';end$$;
create trigger payable_xml_links_immutable before update or delete on payable_xml_private.links for each row execute function payable_xml_private.preserve();
create trigger payable_xml_commands_immutable before update or delete on payable_xml_private.commands for each row execute function payable_xml_private.preserve();
create function payable_xml_private.preserve_object() returns trigger language plpgsql set search_path='' as $$begin if old.bucket_id='payable-xml-quarantine' then raise exception 'payable_xml_immutable' using errcode='55000';end if;return coalesce(new,old);end$$;
create trigger payable_xml_original_immutable before update or delete on storage.objects for each row execute function payable_xml_private.preserve_object();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('payable-xml-quarantine','payable-xml-quarantine',false,2000000,array['application/octet-stream']);
create policy payable_xml_browser_deny on storage.objects as restrictive for all to anon,authenticated using(bucket_id<>'payable-xml-quarantine') with check(bucket_id<>'payable-xml-quarantine');
create function public.reserve_finance_payable_xml(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select payable_xml_private.reserve(_payload)$$;
create function public.prepare_finance_payable_xml(_tenant_id uuid,_actor_id uuid,_artifact_id uuid) returns jsonb language sql security invoker set search_path='' as $$select payable_xml_private.prepare(_tenant_id,_actor_id,_artifact_id)$$;
create function public.finish_finance_payable_xml(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select payable_xml_private.finish(_payload)$$;
create function public.record_finance_payable_xml(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select payable_xml_private.record(_payload)$$;
create function public.get_finance_payable_xml_context(_tenant_id uuid,_payable_id uuid,_offset int default 0,_expected_revision text default null) returns jsonb language sql security invoker set search_path='' as $$select payable_xml_private.context(_tenant_id,_payable_id,_offset,_expected_revision)$$;
revoke all on all functions in schema payable_xml_private from public,anon,authenticated,service_role;
grant execute on function payable_xml_private.reserve(jsonb),payable_xml_private.record(jsonb),payable_xml_private.context(uuid,uuid,int,text) to authenticated;
grant execute on function payable_xml_private.prepare(uuid,uuid,uuid),payable_xml_private.finish(jsonb) to service_role;
revoke all on function public.reserve_finance_payable_xml(jsonb),public.record_finance_payable_xml(jsonb),public.get_finance_payable_xml_context(uuid,uuid,int,text),public.prepare_finance_payable_xml(uuid,uuid,uuid),public.finish_finance_payable_xml(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.reserve_finance_payable_xml(jsonb),public.record_finance_payable_xml(jsonb),public.get_finance_payable_xml_context(uuid,uuid,int,text) to authenticated;
grant execute on function public.prepare_finance_payable_xml(uuid,uuid,uuid),public.finish_finance_payable_xml(jsonb) to service_role;
