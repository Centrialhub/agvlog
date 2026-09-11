create table public.finance_payable_movement_links (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 movement_id uuid not null references public.finance_movements(id),
 payable_id uuid not null references public.payables(id),
 payment_id uuid not null unique references public.payables_payments(id),
 amount_cents bigint not null check(amount_cents>0 and amount_cents<=99999999999999),
 created_by uuid not null,created_at timestamptz not null default clock_timestamp()
);
create index finance_payable_links_movement on public.finance_payable_movement_links(tenant_id,movement_id);
create index finance_payable_links_payable on public.finance_payable_movement_links(tenant_id,payable_id);
alter table public.finance_payable_movement_links enable row level security;
revoke all on public.finance_payable_movement_links from public,anon,authenticated,service_role;
grant select on public.finance_payable_movement_links to authenticated,service_role;
create policy finance_payable_links_read on public.finance_payable_movement_links for select to authenticated using(finance_private.can_access(tenant_id));
create trigger preserve_finance_payable_link before update or delete on public.finance_payable_movement_links
 for each row execute function finance_private.preserve_event();

create function finance_private.movement_used_cents(_tenant uuid,_movement uuid) returns numeric
language sql stable security definer set search_path='' as $$
 select coalesce(sum(amount_cents),0) from (
  select amount_cents from public.finance_expense_allocations where tenant_id=_tenant and movement_id=_movement
  union all
  select amount_cents from public.finance_payable_movement_links where tenant_id=_tenant and movement_id=_movement
 ) allocations;
$$;
revoke all on function finance_private.movement_used_cents(uuid,uuid) from public,anon,authenticated,service_role;

-- Shared capacity applies to both callers, including older expense commands.
create function finance_private.check_movement_use() returns trigger
language plpgsql security definer set search_path='' as $$
declare m public.finance_movements%rowtype; p public.payables_payments%rowtype;
begin
 if not finance_private.can_access(new.tenant_id) then raise exception 'finance_access_denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0));
 select * into m from public.finance_movements where tenant_id=new.tenant_id and id=new.movement_id;
 if not found or m.direction<>'out' or m.nature='transfer' then raise exception 'finance_invalid_payment_movement' using errcode='22023';end if;
 if finance_private.movement_used_cents(new.tenant_id,new.movement_id)+new.amount_cents>m.amount_cents then
  raise exception 'finance_movement_overallocated' using errcode='23514';
 end if;
 if tg_table_name='finance_payable_movement_links' then
  select * into p from public.payables_payments where id=new.payment_id and tenant_id=new.tenant_id;
  if not found or p.payable_id<>new.payable_id or p.amount*100<>new.amount_cents
    or p.bank_account_id<>m.bank_account_id or p.bank_transaction_id is not null then
   raise exception 'finance_payment_link_mismatch' using errcode='23514';
  end if;
 end if;
 return new;
end;
$$;
revoke all on function finance_private.check_movement_use() from public,anon,authenticated,service_role;
create trigger finance_expense_shared_capacity before insert on public.finance_expense_allocations for each row execute function finance_private.check_movement_use();
create trigger finance_payable_shared_capacity before insert on public.finance_payable_movement_links for each row execute function finance_private.check_movement_use();

create function finance_private.protect_linked_payment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.finance_payable_movement_links where payment_id=old.id) then
  raise exception 'finance_linked_payment_requires_audited_correction' using errcode='55000';
 end if;
 return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke all on function finance_private.protect_linked_payment() from public,anon,authenticated,service_role;
create trigger finance_preserve_linked_payment before update or delete on public.payables_payments for each row execute function finance_private.protect_linked_payment();

-- Legacy callers also acquire the same lock before inserting their payment.
-- Otherwise an old register command can race the new allocation command.
create function finance_private.check_payable_payment_insert() returns trigger
language plpgsql security definer set search_path='' as $$
declare p public.payables%rowtype;paid numeric;
begin
 if not finance_private.can_access(new.tenant_id) then raise exception 'finance_access_denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0));
 select * into p from public.payables where id=new.payable_id and tenant_id=new.tenant_id for update;
 if not found or p.status='cancelled' then raise exception 'finance_payable_not_payable' using errcode='22023';end if;
 if new.amount is null or new.amount<=0 or new.amount<>trunc(new.amount,2) or new.amount::text in ('NaN','Infinity','-Infinity') then
  raise exception 'finance_invalid_payment_amount' using errcode='22023';end if;
 if not exists(select 1 from public.bank_accounts where tenant_id=new.tenant_id and id=new.bank_account_id) then
  raise exception 'finance_invalid_account' using errcode='22023';end if;
 select coalesce(sum(amount),0) into paid from public.payables_payments where payable_id=p.id and tenant_id=p.tenant_id;
 if paid<0 or paid<>trunc(paid,2) or paid+new.amount>p.amount then raise exception 'finance_payable_overpaid' using errcode='23514';end if;
 return new;
end;
$$;
revoke all on function finance_private.check_payable_payment_insert() from public,anon,authenticated,service_role;
create trigger finance_payable_payment_capacity before insert on public.payables_payments for each row execute function finance_private.check_payable_payment_insert();

create function finance_private.apply_payable_movement(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid; actor uuid:=auth.uid();request uuid; cents bigint; payment uuid; link uuid;
 p public.payables%rowtype;m public.finance_movements%rowtype;old_command public.finance_commands%rowtype;
 paid numeric;result jsonb;actor_name text;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid; request:=(_payload->>'request_id')::uuid;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if request is null or _payload->>'version' is distinct from '1'
 or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','movement_id','payable_id','amount_cents','method','reason'))
 or coalesce(_payload->>'amount_cents','') !~ '^[0-9]{1,14}$'
 or length(btrim(coalesce(_payload->>'reason',''))) not between 5 and 2000
 or coalesce(_payload->>'method','') not in('pix','boleto','ted','doc','dinheiro','cartao','debito_automatico','other') then
  raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 select * into old_command from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if old_command.actor_id<>actor or old_command.action<>'apply_payable_movement' or old_command.payload<>_payload then
   raise exception 'finance_request_conflict' using errcode='23505';end if;
  return old_command.result;
 end if;
 cents:=(_payload->>'amount_cents')::bigint;
 select * into p from public.payables where id=(_payload->>'payable_id')::uuid and tenant_id=t for update;
 if not found or p.status not in('approved','partial') then raise exception 'finance_payable_not_payable' using errcode='22023';end if;
 select * into m from public.finance_movements where id=(_payload->>'movement_id')::uuid and tenant_id=t;
 if not found or m.direction<>'out' or m.nature='transfer' then raise exception 'finance_invalid_payment_movement' using errcode='22023';end if;
 if p.driver_id is not null and m.driver_id is distinct from p.driver_id then raise exception 'finance_payment_driver_mismatch' using errcode='22023';end if;
 select coalesce(sum(amount),0) into paid from public.payables_payments where tenant_id=t and payable_id=p.id;
 if cents<=0 or paid<0 or paid<>trunc(paid,2) or paid+cents::numeric/100>p.amount then
  raise exception 'finance_payable_overpaid' using errcode='23514';end if;
 if finance_private.movement_used_cents(t,m.id)+cents>m.amount_cents then raise exception 'finance_movement_overallocated' using errcode='23514';end if;
 insert into public.payables_payments(tenant_id,payable_id,amount,paid_at,bank_account_id,method,notes,attachment_url,bank_transaction_id,created_by)
 values(t,p.id,cents::numeric/100,(m.occurred_on+time '12:00') at time zone 'America/Sao_Paulo',m.bank_account_id,
  _payload->>'method',btrim(_payload->>'reason'),m.receipt_path,null,actor) returning id into payment;
 insert into public.finance_payable_movement_links(tenant_id,movement_id,payable_id,payment_id,amount_cents,created_by)
 values(t,m.id,p.id,payment,cents,actor) returning id into link;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'link_id',link,'payment_id',payment,'payable_id',p.id,'movement_id',m.id,'amount_cents',cents::text,'bank_confirmation','not_evaluated');
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into actor_name from auth.users where id=actor;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data)
 values(t,'payable_payment',payment,'payable_movement_applied',actor,coalesce(actor_name,actor::text),btrim(_payload->>'reason'),result||jsonb_build_object('manual_intervention',true));
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'apply_payable_movement',_payload,result);
 return result;
end;
$$;
revoke all on function finance_private.apply_payable_movement(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.apply_payable_movement(jsonb) to authenticated;
create function public.apply_finance_payable_movement(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.apply_payable_movement(_payload);$$;
revoke all on function public.apply_finance_payable_movement(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.apply_finance_payable_movement(jsonb) to authenticated;

-- Existing picker must show the same capacity that commands enforce.
do $picker$
declare body text; original text:='select sum(a.amount_cents) used from public.finance_expense_allocations a where a.tenant_id=_tenant and a.movement_id=m.id';
begin
 select pg_get_functiondef('finance_private.expense_options(uuid,text,text,uuid,integer)'::regprocedure) into body;
 if position(original in body)=0 then raise exception 'finance_expense_picker_contract_changed';end if;
 execute replace(body,original,'select finance_private.movement_used_cents(_tenant,m.id) used');
end;
$picker$;

create function finance_private.payable_movement_options(_tenant uuid,_payable uuid,_search text default '',_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.payables%rowtype;result jsonb;paid numeric;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page not between 1 and 1000000 or length(coalesce(_search,''))>200 then raise exception 'finance_invalid_options' using errcode='22023';end if;
 select * into p from public.payables where id=_payable and tenant_id=_tenant;
 if not found then raise exception 'finance_payable_not_found' using errcode='22023';end if;
 select coalesce(sum(amount),0) into paid from public.payables_payments where tenant_id=_tenant and payable_id=_payable;
 with candidates as materialized (
  select m.id,m.beneficiary_name,m.description,m.occurred_on,m.bank_reference,m.bank_account_id,b.name account_name,
   m.amount_cents::text amount_cents,(m.amount_cents-finance_private.movement_used_cents(_tenant,m.id))::text remaining_cents
  from public.finance_movements m join public.bank_accounts b on b.id=m.bank_account_id and b.tenant_id=_tenant
  where m.tenant_id=_tenant and m.direction='out' and m.nature<>'transfer'
   and (p.driver_id is null or m.driver_id=p.driver_id)
   and m.amount_cents>finance_private.movement_used_cents(_tenant,m.id)
   and position(lower(coalesce(_search,'')) in lower(m.beneficiary_name||' '||m.description||' '||coalesce(m.bank_reference,'')||' '||b.name||' '||m.id::text))>0
 ), paged as(select * from candidates order by occurred_on desc,id limit 30 offset (_page-1)*30)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'payable_id',_payable,'page',_page,'total',(select count(*) from candidates),
  'payable_status',p.status,'payable_name',p.supplier_name,'remaining_cents',(greatest(p.amount-paid,0)*100)::numeric(30,0)::text,
  'can_apply',p.status in('approved','partial') and paid>=0 and paid=trunc(paid,2) and p.amount>paid,
  'rows',coalesce((select jsonb_agg(to_jsonb(row) order by row.occurred_on desc,row.id) from paged row),'[]')) into result;
 return result;
end;
$$;
revoke all on function finance_private.payable_movement_options(uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function finance_private.payable_movement_options(uuid,uuid,text,integer) to authenticated;
create function public.get_finance_payable_movements(_tenant_id uuid,_payable_id uuid,_search text default '',_page integer default 1)
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.payable_movement_options(_tenant_id,_payable_id,_search,_page);$$;
revoke all on function public.get_finance_payable_movements(uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_payable_movements(uuid,uuid,text,integer) to authenticated;
