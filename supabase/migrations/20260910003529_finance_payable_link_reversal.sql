create table public.finance_payable_link_reversals (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 link_id uuid not null unique references public.finance_payable_movement_links(id),
 created_by uuid not null,actor_name text not null,reason text not null check(length(btrim(reason)) between 10 and 2000),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.finance_payable_link_reversals enable row level security;
revoke all on public.finance_payable_link_reversals from public,anon,authenticated,service_role;
grant select on public.finance_payable_link_reversals to authenticated,service_role;
create policy finance_payable_reversals_read on public.finance_payable_link_reversals for select to authenticated using(finance_private.can_access(tenant_id));
create trigger preserve_finance_payable_reversal before update or delete on public.finance_payable_link_reversals for each row execute function finance_private.preserve_event();

-- Private aggregate source only: payment history continues to read the original
-- rows. No browser role can access this definer-owned projection directly.
create view finance_private.active_payable_payments as
 select p.* from public.payables_payments p where not exists(
  select 1 from public.finance_payable_movement_links l join public.finance_payable_link_reversals r on r.link_id=l.id and r.tenant_id=l.tenant_id
  where l.payment_id=p.id and l.tenant_id=p.tenant_id);
revoke all on finance_private.active_payable_payments from public,anon,authenticated,service_role;

create or replace function finance_private.movement_used_cents(_tenant uuid,_movement uuid) returns numeric
language sql stable security definer set search_path='' as $$
 select coalesce(sum(amount_cents),0) from (
  select amount_cents from public.finance_expense_allocations where tenant_id=_tenant and movement_id=_movement
  union all
  select l.amount_cents from public.finance_payable_movement_links l where l.tenant_id=_tenant and l.movement_id=_movement
   and not exists(select 1 from public.finance_payable_link_reversals r where r.link_id=l.id and r.tenant_id=_tenant)
 ) allocations;
$$;

-- Exact reviewed read sites; never rewrite INSERT/DELETE or history readers.
do $active_reads$
declare signature text;body text;original text;replacement text;
begin
 for signature,original,replacement in select * from (values
 ('finance_private.check_payable_payment_insert()','from public.payables_payments where payable_id=p.id','from finance_private.active_payable_payments where payable_id=p.id'),
 ('finance_private.apply_payable_movement(jsonb)','from public.payables_payments where tenant_id=t','from finance_private.active_payable_payments where tenant_id=t'),
 ('finance_private.payable_movement_options(uuid,uuid,text,integer)','from public.payables_payments where tenant_id=_tenant','from finance_private.active_payable_payments where tenant_id=_tenant'),
 ('finance_private.payroll_payment_projection(uuid,uuid)','left join public.payables_payments pp','left join finance_private.active_payable_payments pp'),
 ('public._recalc_payable_paid()','FROM public.payables_payments WHERE','FROM finance_private.active_payable_payments WHERE')
 ) patches loop
  select pg_get_functiondef(signature::regprocedure) into body;
  if position(original in body)=0 then raise exception 'finance_payment_projection_contract_changed: %',signature;end if;
  execute replace(body,original,replacement);
 end loop;
end;
$active_reads$;

create function finance_private.reverse_payable_link(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;actor uuid:=auth.uid();actor_name text;reversal uuid;paid numeric;result jsonb;
 l public.finance_payable_movement_links%rowtype;p public.payables%rowtype;existing public.finance_commands%rowtype;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if request is null or _payload->>'version' is distinct from '1' or length(btrim(coalesce(_payload->>'reason',''))) not between 10 and 2000
 or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','link_id','reason')) then
  raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 select * into existing from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if existing.actor_id<>actor or existing.action<>'reverse_payable_link' or existing.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;
  return existing.result;
 end if;
 select * into l from public.finance_payable_movement_links where id=(_payload->>'link_id')::uuid and tenant_id=t;
 if not found then raise exception 'finance_payable_link_not_found' using errcode='22023';end if;
 if exists(select 1 from public.finance_payable_link_reversals where link_id=l.id) then raise exception 'finance_payable_link_already_reversed' using errcode='22023';end if;
 select * into p from public.payables where id=l.payable_id and tenant_id=t for update;
 if not found then raise exception 'finance_payable_not_found' using errcode='22023';end if;
 if p.source_table='payroll_entries' then
  perform 1 from public.payroll_entries e join public.payroll_periods period on period.id=e.payroll_period_id and period.tenant_id=t
   where e.id=p.source_id and e.tenant_id=t and period.status='closed' for share of period;
  if found then raise exception 'finance_payroll_closed_requires_reopening' using errcode='22023';end if;
 end if;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into actor_name from auth.users where id=actor;
 insert into public.finance_payable_link_reversals(tenant_id,link_id,created_by,actor_name,reason)
 values(t,l.id,actor,coalesce(actor_name,actor::text),btrim(_payload->>'reason')) returning id into reversal;
 select coalesce(sum(amount),0) into paid from finance_private.active_payable_payments where tenant_id=t and payable_id=p.id;
 update public.payables set paid_amount=paid,
  status=case when p.status='cancelled' then 'cancelled' when paid<=0 then case when p.status in('paid','partial') then 'approved' else p.status end
    when paid>=p.amount then 'paid' else 'partial' end,
  paid_at=case when p.status='cancelled' then p.paid_at when paid>=p.amount then coalesce(p.paid_at,now()) else null end,updated_at=now()
 where id=p.id and tenant_id=t;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'reversal_id',reversal,'link_id',l.id,'payment_id',l.payment_id,
  'payable_id',p.id,'movement_id',l.movement_id,'released_cents',l.amount_cents::text);
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(t,'payable_payment',l.payment_id,'payable_link_reversed',actor,coalesce(actor_name,actor::text),btrim(_payload->>'reason'),to_jsonb(l),result||jsonb_build_object('manual_intervention',true));
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'reverse_payable_link',_payload,result);
 return result;
end;
$$;
revoke all on function finance_private.reverse_payable_link(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.reverse_payable_link(jsonb) to authenticated;
create function public.reverse_finance_payable_link(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.reverse_payable_link(_payload);$$;
revoke all on function public.reverse_finance_payable_link(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.reverse_finance_payable_link(jsonb) to authenticated;

create function finance_private.payable_payment_history(_tenant uuid,_payable uuid,_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page not between 1 and 1000000 then raise exception 'finance_invalid_page' using errcode='22023';end if;
 if not exists(select 1 from public.payables where tenant_id=_tenant and id=_payable) then raise exception 'finance_payable_not_found' using errcode='22023';end if;
 with payments as materialized(select p.*,b.name account_name,l.id link_id,l.movement_id,
  case when r.id is null then null else jsonb_build_object('id',r.id,'actor_id',r.created_by,'actor_name',r.actor_name,'reason',r.reason,'created_at',r.created_at) end reversal
  from public.payables_payments p left join public.bank_accounts b on b.id=p.bank_account_id and b.tenant_id=_tenant
  left join public.finance_payable_movement_links l on l.payment_id=p.id and l.tenant_id=_tenant
  left join public.finance_payable_link_reversals r on r.link_id=l.id and r.tenant_id=_tenant
  where p.tenant_id=_tenant and p.payable_id=_payable
 ), paged as(select * from payments order by paid_at desc,id desc limit 30 offset (_page-1)*30)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'payable_id',_payable,'page',_page,'total',(select count(*) from payments),
  'rows',coalesce((select jsonb_agg(to_jsonb(p) order by p.paid_at desc,p.id desc) from paged p),'[]')) into result;
 return result;
end;
$$;
revoke all on function finance_private.payable_payment_history(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function finance_private.payable_payment_history(uuid,uuid,integer) to authenticated;
create function public.get_finance_payable_payment_history(_tenant_id uuid,_payable_id uuid,_page integer default 1)
returns jsonb language sql security invoker set search_path='' as $$select finance_private.payable_payment_history(_tenant_id,_payable_id,_page);$$;
revoke all on function public.get_finance_payable_payment_history(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_payable_payment_history(uuid,uuid,integer) to authenticated;

do $audit_manual$
declare body text; original text:='e.action in(''identity_reviewed_manually'',''identity_review_reversed'')';
begin
 select pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure) into body;
 if position(original in body)=0 then raise exception 'finance_audit_manual_contract_changed';end if;
 execute replace(body,original,'e.action in(''identity_reviewed_manually'',''identity_review_reversed'',''payable_movement_applied'',''payable_link_reversed'')');
end;
$audit_manual$;
