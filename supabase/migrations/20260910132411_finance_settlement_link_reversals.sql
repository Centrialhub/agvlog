-- Correct an association only. The historical payment and the cash remain intact.
create table public.finance_settlement_link_reversals(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 link_id uuid not null unique references public.finance_settlement_movement_links(id),
 created_by uuid not null,actor_name text not null,reason text not null check(length(btrim(reason)) between 10 and 2000),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.finance_settlement_link_reversals enable row level security;
revoke all on public.finance_settlement_link_reversals from public,anon,authenticated,service_role;
grant select on public.finance_settlement_link_reversals to authenticated,service_role;
create policy finance_settlement_reversals_read on public.finance_settlement_link_reversals for select to authenticated using(finance_private.can_access(tenant_id));
create trigger finance_settlement_reversals_immutable before update or delete on public.finance_settlement_link_reversals for each row execute function finance_private.preserve_event();

alter table public.finance_settlement_movement_links drop constraint finance_settlement_movement_links_payment_id_key;
create index finance_settlement_links_payment_history on public.finance_settlement_movement_links(tenant_id,payment_id,created_at,id);

create or replace function finance_private.movement_used_cents(_tenant uuid,_movement uuid) returns numeric
language sql stable security definer set search_path='' as $$
 select coalesce(sum(amount_cents),0) from (
  select amount_cents from public.finance_expense_allocations where tenant_id=_tenant and movement_id=_movement
  union all
  select l.amount_cents from public.finance_payable_movement_links l where l.tenant_id=_tenant and l.movement_id=_movement
   and not exists(select 1 from public.finance_payable_link_reversals r where r.link_id=l.id and r.tenant_id=_tenant)
  union all
  select l.amount_cents from public.finance_settlement_movement_links l where l.tenant_id=_tenant and l.movement_id=_movement
   and not exists(select 1 from public.finance_settlement_link_reversals r where r.link_id=l.id and r.tenant_id=_tenant)
 ) allocations;
$$;

-- Both command and table guard enforce one active association under the finance lock.
do $$declare body text;needle text;begin
 select pg_get_functiondef('finance_private.check_settlement_movement_link()'::regprocedure) into body;
 needle:='select * into payment from public.driver_settlement_payments';
 if position(needle in body)=0 then raise exception 'finance_settlement_guard_contract_changed';end if;
 execute replace(body,needle,$patch$if exists(select 1 from public.finance_settlement_movement_links l where l.tenant_id=new.tenant_id and l.payment_id=new.payment_id
  and not exists(select 1 from public.finance_settlement_link_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id)) then
  raise exception 'finance_settlement_payment_already_linked' using errcode='23505';end if;
 select * into payment from public.driver_settlement_payments$patch$);
 select pg_get_functiondef('finance_private.link_settlement_payment(jsonb)'::regprocedure) into body;
 needle:='select 1 from public.finance_settlement_movement_links where payment_id=p.id';
 if position(needle in body)=0 then raise exception 'finance_settlement_command_contract_changed';end if;
 execute replace(body,needle,$patch$select 1 from public.finance_settlement_movement_links l where l.tenant_id=t and l.payment_id=p.id
  and not exists(select 1 from public.finance_settlement_link_reversals r where r.tenant_id=t and r.link_id=l.id)$patch$);
end$$;

create function finance_private.reverse_settlement_link(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;actor uuid:=auth.uid();actor_name text;reversal uuid;result jsonb;
 l public.finance_settlement_movement_links%rowtype;prior public.finance_commands%rowtype;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if request is null or _payload->>'version' is distinct from '1' or length(btrim(coalesce(_payload->>'reason',''))) not between 10 and 2000
 or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','link_id','reason')) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if prior.actor_id<>actor or prior.action<>'reverse_settlement_link' or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;
  return prior.result;
 end if;
 select * into l from public.finance_settlement_movement_links where id=(_payload->>'link_id')::uuid and tenant_id=t;
 if not found then raise exception 'finance_settlement_link_not_found' using errcode='22023';end if;
 if exists(select 1 from public.finance_settlement_link_reversals where link_id=l.id and tenant_id=t) then raise exception 'finance_settlement_link_already_reversed' using errcode='22023';end if;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into actor_name from auth.users where id=actor;
 insert into public.finance_settlement_link_reversals(tenant_id,link_id,created_by,actor_name,reason)
 values(t,l.id,actor,coalesce(actor_name,actor::text),btrim(_payload->>'reason')) returning id into reversal;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'reversal_id',reversal,'link_id',l.id,'confirmed',true,'cash_changed',false);
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(t,'settlement_payment',l.payment_id,'settlement_link_reversed',actor,coalesce(actor_name,actor::text),btrim(_payload->>'reason'),to_jsonb(l),result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'reverse_settlement_link',_payload,result);
 return result;
end$$;
revoke all on function finance_private.reverse_settlement_link(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.reverse_settlement_link(jsonb) to authenticated;
create function public.reverse_finance_settlement_link(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.reverse_settlement_link(_payload)$$;
revoke all on function public.reverse_finance_settlement_link(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.reverse_finance_settlement_link(jsonb) to authenticated;

do $$declare body text;needle text;begin
 select pg_get_functiondef('finance_private.get_settlement_payment_movements(uuid,uuid,integer)'::regprocedure) into body;
 needle:='where l.tenant_id=_tenant_id and l.payment_id=p.id;';
 if position(needle in body)=0 then raise exception 'finance_settlement_options_contract_changed';end if;
 body:=replace(body,needle,$patch$where l.tenant_id=_tenant_id and l.payment_id=p.id
 and not exists(select 1 from public.finance_settlement_link_reversals r where r.tenant_id=_tenant_id and r.link_id=l.id);$patch$);
 needle:='''link'',linked,''rows''';
 if position(needle in body)=0 then raise exception 'finance_settlement_history_contract_changed';end if;
 execute replace(body,needle,$patch$'link',linked,'history',coalesce((select jsonb_agg(jsonb_build_object(
 'id',l.id,'movement_id',l.movement_id,'amount_cents',l.amount_cents,'created_by',l.created_by,'created_at',l.created_at,
 'actor_name',coalesce(e.actor_name,l.created_by::text),'reason',e.reason,
 'reversal',case when r.id is null then null else jsonb_build_object('id',r.id,'actor_id',r.created_by,'actor_name',r.actor_name,'reason',r.reason,'created_at',r.created_at) end
 ) order by l.created_at,l.id) from public.finance_settlement_movement_links l
 left join public.finance_settlement_link_reversals r on r.link_id=l.id and r.tenant_id=_tenant_id
 left join lateral(select actor_name,reason from public.finance_events where tenant_id=_tenant_id and entity_id=p.id and action='settlement_payment_linked' and after_data->>'link_id'=l.id::text order by created_at,id limit 1) e on true
 where l.tenant_id=_tenant_id and l.payment_id=p.id),'[]'::jsonb),'rows'$patch$);
 select pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure) into body;
 needle:='''identity_reviewed_manually'',''identity_review_reversed''';
 if position(needle in body)=0 then raise exception 'finance_settlement_reversal_audit_contract_changed';end if;
 execute replace(body,needle,'''settlement_link_reversed'','||needle);
end$$;
