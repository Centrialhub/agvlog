-- Administrative pre-dispatch conference only. Does not acknowledge custody or delivery.
set local lock_timeout='3s';
set local statement_timeout='30s';
create table public.load_note_check_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null,
 load_id uuid not null,
 document_id uuid not null,
 actor_id uuid not null,
 request_id uuid not null,
 checked boolean not null,
 revision integer not null check(revision>0),
 recorded_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,actor_id,request_id),
 unique(tenant_id,load_id,document_id,revision)
);
comment on table public.load_note_check_events is 'Immutable load-specific administrative conference. UUID identities deliberately survive source cleanup; no delivery/fiscal/financial effect.';
alter table public.load_note_check_events enable row level security;
revoke all on public.load_note_check_events from public,anon,authenticated,service_role;
grant select on public.load_note_check_events to authenticated;
create policy load_note_check_operator_read on public.load_note_check_events for select to authenticated
 using(auth.uid() is not null and public.is_tenant_operator_or_admin(tenant_id));
create trigger preserve_load_note_check_event before update or delete on public.load_note_check_events
 for each row execute function public._preserve_delivery_document_outcome();

create function public.get_load_note_checks(_tenant_id uuid,_load_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
  raise exception 'not_authorized' using errcode='42501';end if;
 if not exists(select 1 from public.loads where id=_load_id and tenant_id=_tenant_id) then
  raise exception 'load_note_check_load_unavailable' using errcode='22023';end if;
 return coalesce((select jsonb_agg(to_jsonb(s)) from (
  select distinct on(e.document_id) e.document_id,e.checked,e.revision,e.actor_id,e.recorded_at
  from public.load_note_check_events e join public.fiscal_documents d on d.id=e.document_id
   and d.tenant_id=e.tenant_id and d.load_id=e.load_id and d.document_type='inbound' and d.deleted_at is null
  where e.tenant_id=_tenant_id and e.load_id=_load_id order by e.document_id,e.revision desc
 ) s),'[]'::jsonb);
end;$fn$;
revoke all on function public.get_load_note_checks(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_load_note_checks(uuid,uuid) to authenticated;

create function public.set_load_note_check(_tenant_id uuid,_load_id uuid,_document_id uuid,_checked boolean,_revision integer,_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_actor uuid:=auth.uid();v_previous public.load_note_check_events%rowtype;v_event public.load_note_check_events%rowtype;
begin
 if v_actor is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
  raise exception 'not_authorized' using errcode='42501';end if;
 if _checked is null or _revision is null or _revision<0 or _request_id is null or _document_id is null then
  raise exception 'invalid_load_note_check' using errcode='22023';end if;
 -- Lock in the same load -> document order as composition writers. No fiscal facts are changed.
 perform 1 from public.loads where id=_load_id and tenant_id=_tenant_id for update nowait;
 if not found then raise exception 'load_note_check_load_unavailable' using errcode='22023';end if;
 select * into v_event from public.load_note_check_events where tenant_id=_tenant_id and actor_id=v_actor and request_id=_request_id;
 if found then
  if v_event.load_id<>_load_id or v_event.document_id<>_document_id or v_event.checked<>_checked or v_event.revision<>_revision+1 then
   raise exception 'load_note_check_key_mismatch' using errcode='22023';end if;
  return to_jsonb(v_event);
 end if;
 perform 1 from public.fiscal_documents where id=_document_id and tenant_id=_tenant_id and load_id=_load_id
  and document_type='inbound' and deleted_at is null for update nowait;
 if not found then raise exception 'load_note_check_document_unavailable' using errcode='22023';end if;
 select * into v_previous from public.load_note_check_events where tenant_id=_tenant_id and load_id=_load_id and document_id=_document_id order by revision desc limit 1;
 if coalesce(v_previous.revision,0)<>_revision then raise exception 'load_note_check_context_changed' using errcode='40001';end if;
 insert into public.load_note_check_events(tenant_id,load_id,document_id,actor_id,request_id,checked,revision)
 values(_tenant_id,_load_id,_document_id,v_actor,_request_id,_checked,_revision+1) returning * into v_event;
 return to_jsonb(v_event);
end;$fn$;
revoke all on function public.set_load_note_check(uuid,uuid,uuid,boolean,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.set_load_note_check(uuid,uuid,uuid,boolean,integer,uuid) to authenticated;
notify pgrst,'reload schema';
