create or replace function public.list_client_occurrence_messages_v2(
  _tenant_id uuid,
  _occurrence_id uuid,
  _limit integer default 100,
  _before_created_at timestamptz default null,
  _before_id uuid default null
)
returns table(
  id uuid,
  author_role text,
  author_name text,
  message text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_client uuid;
begin
  if _limit < 1 or _limit > 201 then
    raise exception 'Limit must be between 1 and 201' using errcode='22023';
  end if;
  if (_before_created_at is null) <> (_before_id is null) then
    raise exception 'Message cursor is incomplete' using errcode='22023';
  end if;

  select e.client_id
    into v_client
    from public.operational_events e
   where e.id=_occurrence_id
     and e.tenant_id=_tenant_id
     and e.visible_to_client=true;

  if v_client is null then
    raise exception 'Occurrence not found' using errcode='P0002';
  end if;
  if not (v_client=any(public._portal_user_client_ids(_tenant_id))) then
    raise exception 'Permission denied' using errcode='42501';
  end if;

  return query
  select
    m.id,
    m.author_role,
    coalesce(
      p.full_name,
      case when m.author_role='client' then 'Cliente' else 'Operador' end
    ),
    m.message,
    m.created_at
  from public.client_occurrence_messages m
  left join public.profiles p on p.id=m.author_user_id
  where m.tenant_id=_tenant_id
    and m.occurrence_id=_occurrence_id
    and (
      _before_created_at is null
      or (m.created_at,m.id)<(_before_created_at,_before_id)
    )
  order by m.created_at desc,m.id desc
  limit _limit;
end;
$function$;

create or replace function public.reply_client_occurrence(
  _tenant_id uuid,
  _occurrence_id uuid,
  _message text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_client uuid;
  v_id uuid;
begin
  if _message is null or btrim(_message)='' then
    raise exception 'Message cannot be empty' using errcode='22023';
  end if;

  select e.client_id
    into v_client
    from public.operational_events e
   where e.id=_occurrence_id
     and e.tenant_id=_tenant_id
     and e.visible_to_client=true
   for update;

  if v_client is null then
    raise exception 'Occurrence not found' using errcode='P0002';
  end if;
  if not (v_client=any(public._portal_user_client_ids(_tenant_id))) then
    raise exception 'Permission denied' using errcode='42501';
  end if;

  insert into public.client_occurrence_messages(
    tenant_id,occurrence_id,author_user_id,author_role,message
  ) values(
    _tenant_id,_occurrence_id,auth.uid(),'client',btrim(_message)
  ) returning client_occurrence_messages.id into v_id;

  update public.operational_events
     set client_opened=true,
         updated_at=clock_timestamp()
   where id=_occurrence_id
     and tenant_id=_tenant_id;

  return v_id;
end;
$function$;

revoke all on function public.list_client_occurrence_messages_v2(uuid,uuid,integer,timestamptz,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.list_client_occurrence_messages_v2(uuid,uuid,integer,timestamptz,uuid)
to authenticated,service_role;

revoke all on function public.reply_client_occurrence(uuid,uuid,text)
from public,anon,authenticated,service_role;
grant execute on function public.reply_client_occurrence(uuid,uuid,text)
to authenticated,service_role;

comment on function public.list_client_occurrence_messages_v2(uuid,uuid,integer,timestamptz,uuid) is
  'Lists portal occurrence messages only while the occurrence remains explicitly visible to the client.';
comment on function public.reply_client_occurrence(uuid,uuid,text) is
  'Appends a client reply only after locking and rechecking that the occurrence remains visible.';
