-- Associate an existing settlement payment with already recorded money.
-- This command neither records a new payment nor changes payroll balances.
create table public.finance_settlement_movement_links(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 settlement_id uuid not null references public.driver_settlements(id),payment_id uuid not null unique references public.driver_settlement_payments(id),
 movement_id uuid not null references public.finance_movements(id),amount_cents bigint not null check(amount_cents>0 and amount_cents<=99999999999999),
 created_by uuid not null,created_at timestamptz not null default clock_timestamp()
);
create index finance_settlement_links_movement on public.finance_settlement_movement_links(tenant_id,movement_id);
alter table public.finance_settlement_movement_links enable row level security;
revoke all on public.finance_settlement_movement_links from public,anon,authenticated,service_role;
grant select on public.finance_settlement_movement_links to authenticated,service_role;
create policy finance_settlement_links_read on public.finance_settlement_movement_links for select to authenticated using(finance_private.can_access(tenant_id));
create trigger finance_settlement_links_immutable before update or delete on public.finance_settlement_movement_links for each row execute function finance_private.preserve_event();

create or replace function finance_private.movement_used_cents(_tenant uuid,_movement uuid) returns numeric
language sql stable security definer set search_path='' as $$
 select coalesce(sum(amount_cents),0) from (
  select amount_cents from public.finance_expense_allocations where tenant_id=_tenant and movement_id=_movement
  union all
  select l.amount_cents from public.finance_payable_movement_links l where l.tenant_id=_tenant and l.movement_id=_movement
   and not exists(select 1 from public.finance_payable_link_reversals r where r.link_id=l.id and r.tenant_id=_tenant)
  union all
  select amount_cents from public.finance_settlement_movement_links where tenant_id=_tenant and movement_id=_movement
 ) allocations;
$$;

create function finance_private.check_settlement_movement_link() returns trigger language plpgsql security definer set search_path='' as $$
declare payment public.driver_settlement_payments%rowtype;driver uuid;m public.finance_movements%rowtype;
begin
 if not finance_private.can_access(new.tenant_id) then raise exception 'finance_access_denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0));
 if not finance_private.can_access(new.tenant_id) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into payment from public.driver_settlement_payments where id=new.payment_id and tenant_id=new.tenant_id for share;
 if not found or payment.settlement_id<>new.settlement_id or payment.amount*100<>new.amount_cents then raise exception 'finance_settlement_payment_mismatch' using errcode='23514';end if;
 select s.driver_id into driver from public.driver_settlements s where s.id=new.settlement_id and s.tenant_id=new.tenant_id for share;
 if not found or driver is null then raise exception 'finance_settlement_payment_mismatch' using errcode='23514';end if;
 select * into m from public.finance_movements where tenant_id=new.tenant_id and id=new.movement_id;
 if not found or m.direction<>'out' or m.nature='transfer' or m.driver_id is distinct from driver
 or payment.paid_at is null or m.occurred_on<>(payment.paid_at at time zone 'America/Sao_Paulo')::date then
  raise exception 'finance_settlement_movement_mismatch' using errcode='23514';end if;
 if finance_private.movement_used_cents(new.tenant_id,new.movement_id)+new.amount_cents>m.amount_cents then raise exception 'finance_movement_overallocated' using errcode='23514';end if;
 return new;
end$$;
revoke all on function finance_private.check_settlement_movement_link() from public,anon,authenticated,service_role;
create trigger finance_settlement_capacity before insert on public.finance_settlement_movement_links for each row execute function finance_private.check_settlement_movement_link();

create function finance_private.protect_linked_settlement_payment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.finance_settlement_movement_links where tenant_id=old.tenant_id and payment_id=old.id) then
  raise exception 'finance_linked_payment_requires_audited_correction' using errcode='55000';end if;
 return case when tg_op='DELETE' then old else new end;
end$$;
revoke all on function finance_private.protect_linked_settlement_payment() from public,anon,authenticated,service_role;
create trigger finance_settlement_payment_preserve before update or delete on public.driver_settlement_payments for each row execute function finance_private.protect_linked_settlement_payment();

create function finance_private.link_settlement_payment(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;actor uuid:=auth.uid();prior public.finance_commands%rowtype;p public.driver_settlement_payments%rowtype;link uuid;result jsonb;actor_name text;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if request is null or _payload->>'version' is distinct from '1' or length(btrim(coalesce(_payload->>'reason',''))) not between 10 and 2000
 or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','payment_id','movement_id','reason')) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if prior.actor_id<>actor or prior.action<>'link_settlement_payment' or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;
  return prior.result;
 end if;
 select * into p from public.driver_settlement_payments where tenant_id=t and id=(_payload->>'payment_id')::uuid for share;
 if not found or p.amount<=0 or p.amount*100<>trunc(p.amount*100) or p.amount*100>99999999999999 then raise exception 'finance_settlement_payment_mismatch' using errcode='23514';end if;
 if exists(select 1 from public.finance_settlement_movement_links where payment_id=p.id) then raise exception 'finance_settlement_payment_already_linked' using errcode='23505';end if;
 insert into public.finance_settlement_movement_links(tenant_id,settlement_id,payment_id,movement_id,amount_cents,created_by)
 values(t,p.settlement_id,p.id,(_payload->>'movement_id')::uuid,(p.amount*100)::bigint,actor) returning id into link;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'link_id',link,'payment_id',p.id,'settlement_id',p.settlement_id,'movement_id',(_payload->>'movement_id')::uuid,'amount_cents',(p.amount*100)::bigint,'cash_created',false,'confirmed',true);
 select coalesce(u.raw_user_meta_data->>'full_name',u.email,actor::text) into actor_name from auth.users u where u.id=actor;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data)
 values(t,'settlement_payment',p.id,'settlement_payment_linked',actor,coalesce(actor_name,actor::text),btrim(_payload->>'reason'),result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'link_settlement_payment',_payload,result);
 return result;
end$$;
revoke all on function finance_private.link_settlement_payment(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.link_settlement_payment(jsonb) to authenticated;
create function public.link_finance_settlement_payment(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.link_settlement_payment(_payload)$$;
revoke all on function public.link_finance_settlement_payment(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.link_finance_settlement_payment(jsonb) to authenticated;
