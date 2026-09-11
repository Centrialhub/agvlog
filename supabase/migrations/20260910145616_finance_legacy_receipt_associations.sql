-- Legacy receipts have no canonical command ID: preserve that distinction.
create table public.finance_legacy_receipt_movement_links(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),payment_id uuid not null references public.receivables_payments(id),
 receivable_id uuid not null references public.receivables(id),movement_id uuid not null references public.finance_movements(id),
 amount_cents bigint not null check(amount_cents between 1 and 99999999999999),created_by uuid not null,actor_name text not null,
 reason text not null check(length(btrim(reason)) between 10 and 2000),source_snapshot jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(tenant_id,id)
);
create index finance_legacy_receipt_payment on public.finance_legacy_receipt_movement_links(tenant_id,payment_id,created_at,id);
create index finance_legacy_receipt_movement on public.finance_legacy_receipt_movement_links(tenant_id,movement_id);
create table public.finance_legacy_receipt_link_reversals(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,link_id uuid not null,
 created_by uuid not null,actor_name text not null,reason text not null check(length(btrim(reason)) between 10 and 2000),created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,link_id),foreign key(tenant_id,link_id) references public.finance_legacy_receipt_movement_links(tenant_id,id)
);
do $$declare name text;begin
 foreach name in array array['finance_legacy_receipt_movement_links','finance_legacy_receipt_link_reversals'] loop
  execute format('alter table public.%I enable row level security',name);execute format('revoke all on public.%I from public,anon,authenticated,service_role',name);
  execute format('grant select on public.%I to authenticated',name);execute format('create policy finance_legacy_receipt_read on public.%I for select to authenticated using(finance_private.can_access(tenant_id))',name);
  execute format('create trigger finance_legacy_receipt_immutable before update or delete on public.%I for each row execute function finance_private.preserve_event()',name);
 end loop;
end$$;
create function finance_private.receipt_movement_used_cents(_tenant uuid,_movement uuid) returns numeric
language sql stable security definer set search_path='' as $$
 select trunc(coalesce(sum(cents),0)) from(
  select p.amount*100 cents from public.finance_receivable_movement_links l join public.receivables_payments p on p.tenant_id=l.tenant_id and p.id=l.payment_id
   where l.tenant_id=_tenant and l.movement_id=_movement and l.action='receive' and not exists(select 1 from public.finance_receipt_allocation_corrections c where c.tenant_id=p.tenant_id and c.payment_id=p.id)
  union all select l.amount_cents from public.finance_legacy_receipt_movement_links l where l.tenant_id=_tenant and l.movement_id=_movement
   and not exists(select 1 from public.finance_legacy_receipt_link_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id)
 ) usage;
$$;
revoke all on function finance_private.receipt_movement_used_cents(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.legacy_receivable_source_revision(_tenant uuid,_payment uuid) returns text
language sql stable security definer set search_path='' as $$
 select md5(jsonb_build_object('payment',to_jsonb(p),'receivable',to_jsonb(t),'bank_transaction',to_jsonb(b),
 'load_projections',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.load_payments a where a.tenant_id=p.tenant_id and (a.receivable_payment_id=p.id or a.bank_transaction_id=p.bank_transaction_id)),'[]'),
 'refunds',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.receivable_payment_reversals r where r.tenant_id=p.tenant_id and r.payment_id=p.id),'[]'),
 'credits',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.finance_customer_credits c where c.tenant_id=p.tenant_id and c.payment_id=p.id),'[]'),
 'corrections',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.finance_receipt_allocation_corrections c where c.tenant_id=p.tenant_id and c.payment_id=p.id),'[]'))::text)
 from public.receivables_payments p left join public.receivables t on t.tenant_id=p.tenant_id and t.id=p.receivable_id
 left join public.bank_transactions b on b.tenant_id=p.tenant_id and b.id=p.bank_transaction_id where p.tenant_id=_tenant and p.id=_payment;
$$;
revoke all on function finance_private.legacy_receivable_source_revision(uuid,uuid) from public,anon,authenticated,service_role;
create function finance_private.legacy_receivable_payment_issue(_tenant uuid,_payment uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare p public.receivables_payments%rowtype;tx public.bank_transactions%rowtype;begin
 select * into p from public.receivables_payments where tenant_id=_tenant and id=_payment;
 if not found then return 'finance_legacy_receipt_not_found';end if;
 if not exists(select 1 from public.receivables where tenant_id=_tenant and id=p.receivable_id) then return 'finance_legacy_receivable_not_found';end if;
 if p.amount is null or p.amount::text in('NaN','Infinity','-Infinity') or p.amount<=0 or p.amount*100<>trunc(p.amount*100) or p.amount*100>99999999999999 then return 'finance_legacy_receipt_amount_invalid';end if;
 if p.received_at is null or not isfinite(p.received_at) then return 'finance_legacy_receipt_date_invalid';end if;
 if not exists(select 1 from public.bank_accounts where tenant_id=_tenant and id=p.bank_account_id) then return 'finance_legacy_receipt_account_invalid';end if;
 if exists(select 1 from public.finance_receivable_movement_links where tenant_id=_tenant and payment_id=p.id and action='receive')
  or exists(select 1 from public.finance_receipt_allocation_corrections where tenant_id=_tenant and payment_id=p.id) then return 'finance_legacy_receipt_not_eligible';end if;
 if exists(select 1 from public.finance_legacy_receipt_movement_links l where l.tenant_id=_tenant and l.payment_id=p.id and not exists(select 1 from public.finance_legacy_receipt_link_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id)) then return 'finance_legacy_receipt_already_associated';end if;
 if p.bank_transaction_id is not null then
  select * into tx from public.bank_transactions where tenant_id=_tenant and id=p.bank_transaction_id;
  if not found or tx.bank_account_id is distinct from p.bank_account_id or tx.transaction_type is distinct from 'credit' or tx.amount is distinct from p.amount
   or tx.posted_at is null or not isfinite(tx.posted_at) or (tx.posted_at at time zone 'America/Sao_Paulo')::date<>(p.received_at at time zone 'America/Sao_Paulo')::date then return 'finance_legacy_receipt_bank_mismatch';end if;
  if exists(select 1 from public.receivables_payments other where other.tenant_id=_tenant and other.bank_transaction_id=tx.id and other.id<>p.id)
   or exists(select 1 from public.payables_payments other where other.tenant_id=_tenant and other.bank_transaction_id=tx.id)
   or exists(select 1 from public.receivable_payment_reversals other where other.tenant_id=_tenant and other.bank_transaction_id=tx.id)
   or exists(select 1 from public.load_payments other where other.tenant_id=_tenant and other.bank_transaction_id=tx.id
    and (other.receivable_payment_id is distinct from p.id or other.bank_account_id is distinct from p.bank_account_id or other.amount is distinct from p.amount
     or other.payment_date is distinct from (p.received_at at time zone 'America/Sao_Paulo')::date))
   or exists(select 1 from public.finance_receivable_movement_links other where other.tenant_id=_tenant and other.bank_transaction_id=tx.id) then return 'finance_legacy_receipt_bank_ambiguous';end if;
 end if;
 return null;
end$$;
revoke all on function finance_private.legacy_receivable_payment_issue(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.check_receipt_movement_capacity() returns trigger language plpgsql security definer set search_path='' as $$
declare m public.finance_movements%rowtype;p public.receivables_payments%rowtype;issue text;cents numeric;begin
 if tg_table_name='finance_receivable_movement_links' then
  if new.action='reverse' then return new;end if;
 end if;
 if not finance_private.can_access(new.tenant_id) then raise exception 'finance_access_denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0));
 if not finance_private.can_access(new.tenant_id) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into p from public.receivables_payments where tenant_id=new.tenant_id and id=new.payment_id;
 if not found or p.amount is null or p.amount::text in('NaN','Infinity','-Infinity') or p.amount<=0 or p.amount*100<>trunc(p.amount*100) or p.amount*100>99999999999999 then raise exception 'finance_legacy_receipt_amount_invalid' using errcode='23514';end if;
 cents:=p.amount*100;
 select * into m from public.finance_movements where tenant_id=new.tenant_id and id=new.movement_id;
 if not found or m.direction<>'in' or m.nature not in('receipt','customer_advance','other') or m.bank_account_id is distinct from p.bank_account_id or m.occurred_on is distinct from (p.received_at at time zone 'America/Sao_Paulo')::date then raise exception 'finance_receipt_movement_incompatible' using errcode='23514';end if;
 if tg_table_name='finance_legacy_receipt_movement_links' then
  issue:=finance_private.legacy_receivable_payment_issue(new.tenant_id,new.payment_id);
  if issue is not null then raise exception '%',issue using errcode='23514';end if;
  if new.amount_cents::numeric is distinct from cents or new.receivable_id is distinct from p.receivable_id then raise exception 'finance_legacy_receipt_link_mismatch' using errcode='23514';end if;
 else
  if exists(select 1 from public.finance_legacy_receipt_movement_links where tenant_id=new.tenant_id and payment_id=p.id)
   or exists(select 1 from public.finance_receivable_movement_links where tenant_id=new.tenant_id and payment_id=p.id and action='receive') then raise exception 'finance_receipt_already_linked' using errcode='23505';end if;
 end if;
 if finance_private.receipt_movement_used_cents(new.tenant_id,new.movement_id)+cents>m.amount_cents then raise exception 'finance_receipt_movement_capacity_exceeded' using errcode='23514';end if;
 return new;
end$$;
revoke all on function finance_private.check_receipt_movement_capacity() from public,anon,authenticated,service_role;
create trigger finance_legacy_receipt_capacity before insert on public.finance_legacy_receipt_movement_links for each row execute function finance_private.check_receipt_movement_capacity();
create trigger finance_canonical_receipt_capacity before insert on public.finance_receivable_movement_links for each row execute function finance_private.check_receipt_movement_capacity();

create function finance_private.preserve_legacy_receipt_source() returns trigger language plpgsql security definer set search_path='' as $$begin
 if not pg_try_advisory_xact_lock(hashtextextended(old.tenant_id::text||':finance',0)) then raise exception 'finance_receipt_source_concurrent_change' using errcode='40001';end if;
 if tg_table_name='receivables_payments' then
  if exists(select 1 from public.finance_legacy_receipt_movement_links where tenant_id=old.tenant_id and payment_id=old.id) then raise exception 'finance_adopted_receipt_immutable' using errcode='55000';end if;
 elsif exists(select 1 from public.receivables_payments p join public.finance_legacy_receipt_movement_links l on l.tenant_id=p.tenant_id and l.payment_id=p.id where p.tenant_id=old.tenant_id and p.bank_transaction_id=old.id) then raise exception 'finance_adopted_receipt_bank_immutable' using errcode='55000';end if;
 return case when tg_op='DELETE' then old else new end;
end$$;
revoke all on function finance_private.preserve_legacy_receipt_source() from public,anon,authenticated,service_role;
create trigger finance_preserve_adopted_receipt before update or delete on public.receivables_payments for each row execute function finance_private.preserve_legacy_receipt_source();
create trigger finance_preserve_adopted_receipt_bank before update or delete on public.bank_transactions for each row execute function finance_private.preserve_legacy_receipt_source();

create function finance_private.manage_legacy_receivable_association(_payload jsonb,_reverse boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;actor uuid:=auth.uid();actor_name text;p public.receivables_payments%rowtype;m public.finance_movements%rowtype;
 l public.finance_legacy_receipt_movement_links%rowtype;prior public.finance_commands%rowtype;link uuid;reversal uuid;issue text;action text;source jsonb;result jsonb;cents bigint;begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if request is null or _reverse is null or _payload->'version' is distinct from '1'::jsonb or jsonb_typeof(_payload->'reason') is distinct from 'string'
  or length(btrim(coalesce(_payload->>'reason',''))) not between 10 and 2000
  or exists(select 1 from jsonb_object_keys(_payload) k where k<>all(case when _reverse then array['version','tenant_id','request_id','link_id','reason'] else array['version','tenant_id','request_id','payment_id','movement_id','revision','reason','existing_receipt_confirmed'] end)) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if not _reverse and (_payload->'existing_receipt_confirmed' is distinct from 'true'::jsonb or jsonb_typeof(_payload->'revision') is distinct from 'string' or coalesce(_payload->>'revision','') !~ '^[a-f0-9]{32}$') then raise exception 'finance_invalid_receipt_declaration' using errcode='22023';end if;
 action:=case when _reverse then 'reverse_legacy_receivable_association' else 'associate_legacy_receivable_payment' end;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if prior.actor_id<>actor or prior.action<>action or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return prior.result;
 end if;
 if _reverse then
  select * into l from public.finance_legacy_receipt_movement_links where tenant_id=t and id=(_payload->>'link_id')::uuid;
  if not found then raise exception 'finance_legacy_receipt_association_not_found' using errcode='22023';end if;
  if exists(select 1 from public.finance_legacy_receipt_link_reversals where tenant_id=t and link_id=l.id) then raise exception 'finance_legacy_receipt_association_already_reversed' using errcode='22023';end if;
  select * into p from public.receivables_payments where tenant_id=t and id=l.payment_id;
 else select * into p from public.receivables_payments where tenant_id=t and id=(_payload->>'payment_id')::uuid;end if;
 if not found then raise exception 'finance_legacy_receipt_not_found' using errcode='22023';end if;
 perform public._lock_receivable_financial_graph(t,p.receivable_id);
 select * into p from public.receivables_payments where tenant_id=t and id=p.id for update;
 if not found then raise exception 'finance_legacy_receipt_not_found' using errcode='22023';end if;
 if p.bank_transaction_id is not null then perform 1 from public.bank_transactions where tenant_id=t and id=p.bank_transaction_id for share;end if;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into actor_name from auth.users where id=actor;actor_name:=coalesce(actor_name,actor::text);
 if _reverse then
  insert into public.finance_legacy_receipt_link_reversals(tenant_id,link_id,created_by,actor_name,reason) values(t,l.id,actor,actor_name,btrim(_payload->>'reason')) returning id into reversal;
  result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'link_id',l.id,'payment_id',l.payment_id,'receivable_id',l.receivable_id,'movement_id',l.movement_id,'reversal_id',reversal,'released_cents',l.amount_cents::text,'origin','legacy_adoption','cash_changed',false,'payment_changed',false,'confirmed',true);
 else
  if finance_private.legacy_receivable_source_revision(t,p.id) is distinct from _payload->>'revision' then raise exception 'finance_legacy_receipt_changed' using errcode='40001';end if;
  issue:=finance_private.legacy_receivable_payment_issue(t,p.id);if issue is not null then raise exception '%',issue using errcode='23514';end if;
  cents:=(p.amount*100)::bigint;
  select * into m from public.finance_movements where tenant_id=t and id=(_payload->>'movement_id')::uuid;
  if not found or m.direction<>'in' or m.nature not in('receipt','customer_advance','other') or m.bank_account_id is distinct from p.bank_account_id
   or m.occurred_on is distinct from (p.received_at at time zone 'America/Sao_Paulo')::date then raise exception 'finance_receipt_movement_incompatible' using errcode='23514';end if;
  source:=jsonb_build_object('payment',to_jsonb(p),'receivable',(select to_jsonb(r) from public.receivables r where r.tenant_id=t and r.id=p.receivable_id),'bank_transaction',(select to_jsonb(b) from public.bank_transactions b where b.tenant_id=t and b.id=p.bank_transaction_id),'load_projections',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.load_payments a where a.tenant_id=t and (a.receivable_payment_id=p.id or a.bank_transaction_id=p.bank_transaction_id)),'[]'),'revision',_payload->>'revision','existing_receipt_confirmed',true);
  insert into public.finance_legacy_receipt_movement_links(tenant_id,payment_id,receivable_id,movement_id,amount_cents,created_by,actor_name,reason,source_snapshot)
  values(t,p.id,p.receivable_id,m.id,cents,actor,actor_name,btrim(_payload->>'reason'),source) returning id into link;
  result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'payment_id',p.id,'receivable_id',p.receivable_id,'movement_id',m.id,'link_id',link,'amount_cents',cents::text,'bank_transaction_id',p.bank_transaction_id,'origin','legacy_adoption','cash_created',false,'payment_created',false,'confirmed',true);
 end if;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(t,'receivable_payment',p.id,case when _reverse then 'legacy_receivable_association_reversed' else 'legacy_receivable_associated' end,actor,actor_name,btrim(_payload->>'reason'),case when _reverse then to_jsonb(l) else source end,result||jsonb_build_object('manual_intervention',true));
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,action,_payload,result);return result;
end$$;
revoke all on function finance_private.manage_legacy_receivable_association(jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function finance_private.manage_legacy_receivable_association(jsonb,boolean) to authenticated;
create function public.associate_finance_legacy_receivable_payment(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.manage_legacy_receivable_association(_payload,false)$$;
create function public.reverse_finance_legacy_receivable_association(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.manage_legacy_receivable_association(_payload,true)$$;
revoke all on function public.associate_finance_legacy_receivable_payment(jsonb),public.reverse_finance_legacy_receivable_association(jsonb) from public,anon,service_role;
grant execute on function public.associate_finance_legacy_receivable_payment(jsonb),public.reverse_finance_legacy_receivable_association(jsonb) to authenticated;

-- Current canonical command and picker share the same exact reservation calculation.
do $$declare body text;first_at integer;next_at integer;needle text;begin
 select pg_get_functiondef('finance_private.project_receivable_command()'::regprocedure) into body;
 first_at:=position('select coalesce(sum(p.amount*100),0) into allocated' in body);next_at:=position('if allocated+amount*100' in body);
 if first_at=0 or next_at<=first_at then raise exception 'finance_receipt_capacity_projection_changed';end if;
 execute substring(body from 1 for first_at-1)||'allocated:=finance_private.receipt_movement_used_cents(new.tenant_id,selected.id); '||substring(body from next_at);
 select pg_get_functiondef('finance_private.receipt_movement_options(uuid,uuid,date,text,integer)'::regprocedure) into body;
 first_at:=position('m.amount_cents-coalesce((select sum(p.amount*100)' in body);next_at:=position(' available' in substring(body from first_at));
 if first_at=0 or next_at=0 then raise exception 'finance_receipt_capacity_picker_changed';end if;
 execute substring(body from 1 for first_at-1)||'m.amount_cents-finance_private.receipt_movement_used_cents(_tenant,m.id)'||substring(body from first_at+next_at-1);
 select pg_get_functiondef('finance_private.correct_receipt_allocation(jsonb)'::regprocedure) into body;
 needle:='perform public._lock_receivable_financial_graph(t,payment.receivable_id);';
 if position(needle in body)=0 then raise exception 'finance_legacy_receipt_correction_contract_changed';end if;
 execute replace(body,needle,needle||' if exists(select 1 from public.finance_legacy_receipt_movement_links where tenant_id=t and payment_id=payment.id) then raise exception ''finance_legacy_receipt_requires_association_reversal'' using errcode=''23514'';end if;');
 select pg_get_functiondef('finance_private.legacy_adoption_candidates(uuid,uuid,date,date)'::regprocedure) into body;
 needle:='where l.tenant_id=p.tenant_id and l.payment_id=p.id and l.action=''receive'')';
 if position(needle in body)=0 then raise exception 'finance_legacy_receipt_inventory_contract_changed';end if;
 execute replace(body,needle,needle||' and not exists(select 1 from public.finance_legacy_receipt_movement_links legacy where legacy.tenant_id=p.tenant_id and legacy.payment_id=p.id and not exists(select 1 from public.finance_legacy_receipt_link_reversals rv where rv.tenant_id=legacy.tenant_id and rv.link_id=legacy.id))');
 select pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure) into body;needle:='''identity_reviewed_manually'',''identity_review_reversed''';
 if position(needle in body)=0 then raise exception 'finance_legacy_receipt_audit_contract_changed';end if;
 execute replace(body,needle,'''legacy_receivable_associated'',''legacy_receivable_association_reversed'','||needle);
end$$;
