create table public.finance_internal_transfers(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 outgoing_id uuid not null,incoming_id uuid not null,created_by uuid not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id),unique(tenant_id,outgoing_id),unique(tenant_id,incoming_id),check(outgoing_id<>incoming_id),
 foreign key(tenant_id,outgoing_id) references public.finance_movements(tenant_id,id),
 foreign key(tenant_id,incoming_id) references public.finance_movements(tenant_id,id)
);
alter table public.finance_internal_transfers enable row level security;
revoke all on public.finance_internal_transfers from public,anon,authenticated,service_role;
grant select on public.finance_internal_transfers to authenticated,service_role;
create policy finance_internal_transfers_read on public.finance_internal_transfers for select to authenticated using(finance_private.can_access(tenant_id));
create trigger finance_internal_transfers_immutable before update or delete on public.finance_internal_transfers for each row execute function finance_private.preserve_event();

create function finance_private.record_internal_transfer(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;actor uuid:=auth.uid();prior public.finance_commands%rowtype;
 source uuid;destination uuid;source_name text;destination_name text;cents bigint;debit_date date;credit_date date;
 debit uuid:=gen_random_uuid();credit uuid:=gen_random_uuid();transfer uuid:=gen_random_uuid();result jsonb;actor_name text;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if request is null or _payload->>'version' is distinct from '1' or _payload->>'both_recorded' is distinct from 'true'
 or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','source_account_id','destination_account_id','amount_cents','debited_on','credited_on','source_reference','destination_reference','reason','both_recorded')) then
  raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if prior.actor_id<>actor or prior.action<>'record_internal_transfer' or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;
  return prior.result;
 end if;
 if coalesce(_payload->>'amount_cents','') !~ '^[0-9]{1,14}$'
 or length(btrim(coalesce(_payload->>'reason',''))) not between 5 and 2000
 or coalesce(_payload->>'debited_on','') !~ '^\d{4}-\d{2}-\d{2}$'
 or coalesce(_payload->>'credited_on','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 cents:=(_payload->>'amount_cents')::bigint;debit_date:=(_payload->>'debited_on')::date;credit_date:=(_payload->>'credited_on')::date;
 if cents<=0 or credit_date<debit_date or credit_date>(clock_timestamp() at time zone 'America/Sao_Paulo')::date then raise exception 'finance_invalid_realized_movement' using errcode='22023';end if;
 source:=(_payload->>'source_account_id')::uuid;destination:=(_payload->>'destination_account_id')::uuid;
 if source is null or destination is null or source=destination then raise exception 'finance_transfer_distinct_accounts_required' using errcode='22023';end if;
 -- Lock both registrations in a stable order before checking tenant/activity.
 perform 1 from public.bank_accounts where tenant_id=t and id in(source,destination) order by id for share;
 select name into source_name from public.bank_accounts where id=source and tenant_id=t and active;
 if not found then raise exception 'finance_invalid_account' using errcode='22023';end if;
 select name into destination_name from public.bank_accounts where id=destination and tenant_id=t and active;
 if not found then raise exception 'finance_invalid_account' using errcode='22023';end if;
 if exists(select 1 from public.finance_movements m where m.tenant_id=t and
  ((m.bank_account_id=source and m.bank_reference=nullif(btrim(_payload->>'source_reference'),'')) or
   (m.bank_account_id=destination and m.bank_reference=nullif(btrim(_payload->>'destination_reference'),'')))) then
  raise exception 'finance_reference_already_recorded' using errcode='23505';end if;
 insert into public.finance_movements(id,tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,bank_reference,created_by)
 values(debit,t,source,'out','transfer',cents,debit_date,'Transferência entre contas próprias',left(coalesce(destination_name,destination::text),300),nullif(btrim(_payload->>'source_reference'),''),actor),
 (credit,t,destination,'in','transfer',cents,credit_date,'Transferência entre contas próprias',left(coalesce(source_name,source::text),300),nullif(btrim(_payload->>'destination_reference'),''),actor);
 insert into public.finance_internal_transfers(id,tenant_id,outgoing_id,incoming_id,created_by) values(transfer,t,debit,credit,actor);
 select coalesce(u.raw_user_meta_data->>'full_name',u.email,actor::text) into actor_name from auth.users u where u.id=actor;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'transfer_id',transfer,'outgoing_id',debit,'incoming_id',credit,'confirmed',true,'bank_confirmed',false);
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data)
 values(t,'internal_transfer',transfer,'internal_transfer_recorded',actor,coalesce(actor_name,actor::text),btrim(_payload->>'reason'),result||jsonb_build_object('amount_cents',cents,'source_account_id',source,'destination_account_id',destination,'debited_on',debit_date,'credited_on',credit_date));
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'record_internal_transfer',_payload,result);
 return result;
end$$;
revoke all on function finance_private.record_internal_transfer(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.record_internal_transfer(jsonb) to authenticated;
create function public.record_finance_internal_transfer(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.record_internal_transfer(_payload)$$;
revoke all on function public.record_finance_internal_transfer(jsonb) from public,anon,service_role;
grant execute on function public.record_finance_internal_transfer(jsonb) to authenticated;

-- Preserve replies for historical requests; require a pair for new transfers.
do $$declare body text;needle text;begin
 select pg_get_functiondef('finance_private.record_movement(jsonb)'::regprocedure) into body;
 needle:=' if coalesce(_payload->>''amount_cents'','''')';
 if position(needle in body)=0 then raise exception 'finance_transfer_movement_contract_changed';end if;
 body:=replace(body,needle,' if _payload->>''nature''=''transfer'' then raise exception ''finance_transfer_pair_required'' using errcode=''22023'';end if;'||chr(10)||needle);
 execute body;
end$$;
