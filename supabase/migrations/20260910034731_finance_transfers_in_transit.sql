create table public.finance_transfer_departures(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 outgoing_id uuid not null,destination_account_id uuid not null references public.bank_accounts(id),
 created_by uuid not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id),unique(tenant_id,outgoing_id),
 foreign key(tenant_id,outgoing_id) references public.finance_movements(tenant_id,id)
);
alter table public.finance_transfer_departures enable row level security;
revoke all on public.finance_transfer_departures from public,anon,authenticated,service_role;
grant select on public.finance_transfer_departures to authenticated,service_role;
create policy finance_transfer_departures_read on public.finance_transfer_departures for select to authenticated using(finance_private.can_access(tenant_id));
create trigger finance_transfer_departures_immutable before update or delete on public.finance_transfer_departures for each row execute function finance_private.preserve_event();

create function finance_private.record_transfer_stage(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;actor uuid:=auth.uid();stage text;prior public.finance_commands%rowtype;
 source uuid;destination uuid;party text;cents bigint;day date;movement uuid:=gen_random_uuid();departure uuid;pair uuid;
 original public.finance_movements%rowtype;pending public.finance_transfer_departures%rowtype;result jsonb;actor_name text;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;stage:=_payload->>'stage';
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if request is null or _payload->>'version' is distinct from '1' or stage is null or stage not in('depart','arrive') or _payload->>'occurred' is distinct from 'true'
 or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','stage','source_account_id','destination_account_id','amount_cents','occurred_on','bank_reference','reason','occurred','departure_id')) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if (stage='arrive' and (_payload ? 'source_account_id' or _payload ? 'destination_account_id' or _payload ? 'amount_cents'))
 or (stage='depart' and _payload ? 'departure_id') then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if prior.actor_id<>actor or prior.action<>'record_transfer_stage' or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;
  return prior.result;
 end if;
 if length(btrim(coalesce(_payload->>'reason',''))) not between 5 and 2000 or coalesce(_payload->>'occurred_on','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 day:=(_payload->>'occurred_on')::date;
 if day>(clock_timestamp() at time zone 'America/Sao_Paulo')::date then raise exception 'finance_invalid_realized_movement' using errcode='22023';end if;
 if stage='depart' then
  if coalesce(_payload->>'amount_cents','') !~ '^[0-9]{1,14}$' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
  cents:=(_payload->>'amount_cents')::bigint;source:=(_payload->>'source_account_id')::uuid;destination:=(_payload->>'destination_account_id')::uuid;
  if cents<=0 or source is null or destination is null or source=destination then raise exception 'finance_invalid_payload' using errcode='22023';end if;
  perform 1 from public.bank_accounts where tenant_id=t and id in(source,destination) order by id for share;
  if (select count(*) from public.bank_accounts where tenant_id=t and active and id in(source,destination))<>2 then raise exception 'finance_invalid_account' using errcode='22023';end if;
  select name into party from public.bank_accounts where id=destination;
 else
  departure:=(_payload->>'departure_id')::uuid;
  select * into pending from public.finance_transfer_departures where tenant_id=t and id=departure;
  if not found then raise exception 'finance_transfer_departure_not_found' using errcode='P0002';end if;
  if exists(select 1 from public.finance_internal_transfers where tenant_id=t and outgoing_id=pending.outgoing_id) then raise exception 'finance_transfer_already_arrived' using errcode='23514';end if;
  select * into original from public.finance_movements where tenant_id=t and id=pending.outgoing_id;
  if not found or original.direction<>'out' or original.nature<>'transfer' or day<original.occurred_on then raise exception 'finance_transfer_invalid_arrival' using errcode='23514';end if;
  cents:=original.amount_cents;source:=original.bank_account_id;destination:=pending.destination_account_id;
  perform 1 from public.bank_accounts where tenant_id=t and id=destination and active for share;
  if not found then raise exception 'finance_invalid_account' using errcode='22023';end if;
  select name into party from public.bank_accounts where tenant_id=t and id=source;
 end if;
 if exists(select 1 from public.finance_movements where tenant_id=t and bank_account_id=case when stage='depart' then source else destination end
  and bank_reference=nullif(btrim(_payload->>'bank_reference'),'')) then raise exception 'finance_reference_already_recorded' using errcode='23505';end if;
 insert into public.finance_movements(id,tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,bank_reference,created_by)
 values(movement,t,case when stage='depart' then source else destination end,case when stage='depart' then 'out' else 'in' end,'transfer',cents,day,
  case when stage='depart' then 'Saída de transferência em trânsito' else 'Entrada de transferência anteriormente em trânsito' end,left(coalesce(party,'Conta própria'),300),nullif(btrim(_payload->>'bank_reference'),''),actor);
 if stage='depart' then
  departure:=gen_random_uuid();insert into public.finance_transfer_departures(id,tenant_id,outgoing_id,destination_account_id,created_by) values(departure,t,movement,destination,actor);
 else
  pair:=gen_random_uuid();insert into public.finance_internal_transfers(id,tenant_id,outgoing_id,incoming_id,created_by) values(pair,t,pending.outgoing_id,movement,actor);
 end if;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'stage',stage,'departure_id',departure,'movement_id',movement,'transfer_id',pair,'confirmed',true,'bank_confirmed',false);
 select coalesce(u.raw_user_meta_data->>'full_name',u.email,actor::text) into actor_name from auth.users u where u.id=actor;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data)
 values(t,'transfer_departure',departure,case when stage='depart' then 'transfer_departed' else 'transfer_arrived' end,actor,coalesce(actor_name,actor::text),btrim(_payload->>'reason'),result||jsonb_build_object('amount_cents',cents,'source_account_id',source,'destination_account_id',destination,'occurred_on',day));
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'record_transfer_stage',_payload,result);
 return result;
end$$;
revoke all on function finance_private.record_transfer_stage(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.record_transfer_stage(jsonb) to authenticated;
create function public.record_finance_transfer_stage(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.record_transfer_stage(_payload)$$;
revoke all on function public.record_finance_transfer_stage(jsonb) from public,anon,service_role;
grant execute on function public.record_finance_transfer_stage(jsonb) to authenticated;

create function finance_private.pending_transfers(_tenant uuid,_page integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page<1 or _page>100000 then raise exception 'finance_invalid_page' using errcode='22023';end if;
 with pending as (
  select d.id,d.outgoing_id,m.amount_cents,m.occurred_on,d.destination_account_id,m.bank_account_id source_account_id,
   src.name source_name,dst.name destination_name,m.bank_reference,d.created_by,d.created_at
  from public.finance_transfer_departures d join public.finance_movements m on m.tenant_id=d.tenant_id and m.id=d.outgoing_id
  join public.bank_accounts src on src.tenant_id=d.tenant_id and src.id=m.bank_account_id
  join public.bank_accounts dst on dst.tenant_id=d.tenant_id and dst.id=d.destination_account_id
  where d.tenant_id=_tenant and not exists(select 1 from public.finance_internal_transfers p where p.tenant_id=d.tenant_id and p.outgoing_id=d.outgoing_id)
 ), rows as(select * from pending order by occurred_on,id limit 20 offset ((_page-1)*20))
 select jsonb_build_object('version',1,'tenant_id',_tenant,'page',_page,'page_size',20,'total',(select count(*) from pending),
  'amount_cents',coalesce((select sum(amount_cents) from pending),0)::text,
  'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.occurred_on,r.id) from rows r),'[]'::jsonb)) into result;
 return result;
end$$;
revoke all on function finance_private.pending_transfers(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function finance_private.pending_transfers(uuid,integer) to authenticated;
create function public.get_finance_pending_transfers(_tenant_id uuid,_page integer) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.pending_transfers(_tenant_id,_page)$$;
revoke all on function public.get_finance_pending_transfers(uuid,integer) from public,anon,service_role;
grant execute on function public.get_finance_pending_transfers(uuid,integer) to authenticated;
