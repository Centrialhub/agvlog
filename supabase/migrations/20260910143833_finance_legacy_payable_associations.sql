-- Reuse shared capacity; association reversal never reverses an old payment.
alter table public.finance_payable_movement_links add column origin text not null default 'canonical' check(origin in('canonical','legacy_adoption')),
 add column reason text,add column actor_name text,add column source_snapshot jsonb,
 add constraint finance_legacy_payable_source_required check(origin='canonical' or (reason is not null and length(btrim(reason)) between 10 and 2000 and actor_name is not null and source_snapshot is not null));
alter table public.finance_payable_movement_links drop constraint finance_payable_movement_links_payment_id_key;
create index finance_payable_payment_link_history on public.finance_payable_movement_links(tenant_id,payment_id,created_at,id);

create function finance_private.legacy_payable_payment_issue(_tenant uuid,_payment uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare p public.payables_payments%rowtype;title public.payables%rowtype;tx public.bank_transactions%rowtype;begin
 select * into p from public.payables_payments where tenant_id=_tenant and id=_payment;
 if not found then return 'finance_legacy_payment_not_found';end if;
 select * into title from public.payables where tenant_id=_tenant and id=p.payable_id;
 if not found then return 'finance_legacy_payable_not_found';end if;
 if p.amount is null or p.amount::text in('NaN','Infinity','-Infinity') or p.amount<=0 or p.amount*100<>trunc(p.amount*100) or p.amount*100>99999999999999 then return 'finance_legacy_payment_amount_invalid';end if;
 if p.paid_at is null or not isfinite(p.paid_at) then return 'finance_legacy_payment_date_invalid';end if;
 if not exists(select 1 from public.bank_accounts where tenant_id=_tenant and id=p.bank_account_id) then return 'finance_legacy_payment_account_invalid';end if;
 if exists(select 1 from public.finance_payable_movement_links where tenant_id=_tenant and payment_id=p.id and origin='canonical') then return 'finance_legacy_payment_not_eligible';end if;
 if exists(select 1 from public.finance_payable_movement_links l where l.tenant_id=_tenant and l.payment_id=p.id and not exists(select 1 from public.finance_payable_link_reversals r where r.tenant_id=_tenant and r.link_id=l.id)) then return 'finance_legacy_payment_already_associated';end if;
 if p.bank_transaction_id is not null then
  select * into tx from public.bank_transactions where tenant_id=_tenant and id=p.bank_transaction_id;
  if not found or tx.bank_account_id is distinct from p.bank_account_id or tx.transaction_type is distinct from 'debit'
   or tx.amount is distinct from p.amount or tx.posted_at is null or not isfinite(tx.posted_at)
   or (tx.posted_at at time zone 'America/Sao_Paulo')::date<>(p.paid_at at time zone 'America/Sao_Paulo')::date then return 'finance_legacy_bank_source_mismatch';end if;
  if exists(select 1 from public.payables_payments other where other.tenant_id=_tenant and other.bank_transaction_id=tx.id and other.id<>p.id)
   or exists(select 1 from public.receivables_payments other where other.tenant_id=_tenant and other.bank_transaction_id=tx.id)
   or exists(select 1 from public.receivable_payment_reversals other where other.tenant_id=_tenant and other.bank_transaction_id=tx.id)
   or exists(select 1 from public.load_payments other where other.tenant_id=_tenant and other.bank_transaction_id=tx.id)
   or exists(select 1 from public.finance_receivable_movement_links other where other.tenant_id=_tenant and other.bank_transaction_id=tx.id) then return 'finance_legacy_bank_source_ambiguous';end if;
 end if;
 return null;
end$$;
revoke all on function finance_private.legacy_payable_payment_issue(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.legacy_payable_source_revision(_tenant uuid,_payment uuid) returns text
language sql stable security definer set search_path='' as $$
 select md5(jsonb_build_object('payment',to_jsonb(p),'payable',to_jsonb(t),'bank_transaction',to_jsonb(b))::text)
 from public.payables_payments p join public.payables t on t.tenant_id=p.tenant_id and t.id=p.payable_id
 left join public.bank_transactions b on b.tenant_id=p.tenant_id and b.id=p.bank_transaction_id
 where p.tenant_id=_tenant and p.id=_payment;
$$;
revoke all on function finance_private.legacy_payable_source_revision(uuid,uuid) from public,anon,authenticated,service_role;

-- Reversed canonical allocations remove payment projection; historical paid money remains paid.
create or replace view finance_private.active_payable_payments as
 select p.* from public.payables_payments p where not exists(
  select 1 from public.finance_payable_movement_links l join public.finance_payable_link_reversals r on r.link_id=l.id and r.tenant_id=l.tenant_id
  where l.payment_id=p.id and l.tenant_id=p.tenant_id and l.origin='canonical');
revoke all on finance_private.active_payable_payments from public,anon,authenticated,service_role;

create or replace function finance_private.check_movement_use() returns trigger
language plpgsql security definer set search_path='' as $$
declare m public.finance_movements%rowtype;p public.payables_payments%rowtype;issue text;begin
 if not finance_private.can_access(new.tenant_id) then raise exception 'finance_access_denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0));
 if not finance_private.can_access(new.tenant_id) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into m from public.finance_movements where tenant_id=new.tenant_id and id=new.movement_id;
 if not found or m.direction<>'out' or m.nature='transfer' then raise exception 'finance_invalid_payment_movement' using errcode='22023';end if;
 if finance_private.movement_used_cents(new.tenant_id,new.movement_id)+new.amount_cents>m.amount_cents then raise exception 'finance_movement_overallocated' using errcode='23514';end if;
 if tg_table_name='finance_payable_movement_links' then
  if exists(select 1 from public.finance_payable_movement_links l where l.tenant_id=new.tenant_id and l.payment_id=new.payment_id
   and (l.origin='canonical' or new.origin='canonical' or not exists(select 1 from public.finance_payable_link_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id))) then
   raise exception 'finance_payment_already_linked' using errcode='23505';end if;
  select * into p from public.payables_payments where tenant_id=new.tenant_id and id=new.payment_id;
  if not found or p.payable_id is distinct from new.payable_id or p.amount is null or p.amount::text in('NaN','Infinity','-Infinity')
   or p.amount*100 is distinct from new.amount_cents::numeric or p.bank_account_id is distinct from m.bank_account_id then raise exception 'finance_payment_link_mismatch' using errcode='23514';end if;
  if new.origin='legacy_adoption' then
   issue:=finance_private.legacy_payable_payment_issue(new.tenant_id,new.payment_id);
   if issue is not null then raise exception '%',issue using errcode='23514';end if;
   if m.occurred_on is distinct from (p.paid_at at time zone 'America/Sao_Paulo')::date
    or exists(select 1 from public.payables title where title.tenant_id=new.tenant_id and title.id=p.payable_id and title.driver_id is not null and title.driver_id is distinct from m.driver_id) then raise exception 'finance_legacy_movement_mismatch' using errcode='23514';end if;
  elsif p.bank_transaction_id is not null then raise exception 'finance_payment_link_mismatch' using errcode='23514';end if;
 end if;
 return new;
end$$;

create function finance_private.preserve_adopted_bank_transaction() returns trigger language plpgsql security definer set search_path='' as $$begin
 -- Legacy writers may already hold this row; do not wait in inverse lock order.
 if not pg_try_advisory_xact_lock(hashtextextended(old.tenant_id::text||':finance',0)) then raise exception 'finance_bank_source_concurrent_change' using errcode='40001';end if;
 if exists(select 1 from public.payables_payments p join public.finance_payable_movement_links l on l.tenant_id=p.tenant_id and l.payment_id=p.id where p.tenant_id=old.tenant_id and p.bank_transaction_id=old.id and l.origin='legacy_adoption') then
  raise exception 'finance_adopted_bank_source_immutable' using errcode='55000';end if;
 return case when tg_op='DELETE' then old else new end;
end$$;
revoke all on function finance_private.preserve_adopted_bank_transaction() from public,anon,authenticated,service_role;
create trigger finance_preserve_adopted_bank_source before update or delete on public.bank_transactions for each row execute function finance_private.preserve_adopted_bank_transaction();

create function finance_private.manage_legacy_payable_association(_payload jsonb,_reverse boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;actor uuid:=auth.uid();actor_name text;payment public.payables_payments%rowtype;title public.payables%rowtype;
 movement public.finance_movements%rowtype;l public.finance_payable_movement_links%rowtype;prior public.finance_commands%rowtype;
 link uuid;reversal uuid;result jsonb;issue text;action text;source jsonb;cents bigint;begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if request is null or _reverse is null or _payload->'version' is distinct from '1'::jsonb
  or jsonb_typeof(_payload->'reason') is distinct from 'string' or length(btrim(coalesce(_payload->>'reason',''))) not between 10 and 2000
  or exists(select 1 from jsonb_object_keys(_payload) k where k<>all(case when _reverse then array['version','tenant_id','request_id','link_id','reason'] else array['version','tenant_id','request_id','payment_id','movement_id','revision','reason'] end)) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if not _reverse and (jsonb_typeof(_payload->'revision') is distinct from 'string' or coalesce(_payload->>'revision','') !~ '^[a-f0-9]{32}$') then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 action:=case when _reverse then 'reverse_legacy_payable_association' else 'associate_legacy_payable_payment' end;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if prior.actor_id<>actor or prior.action<>action or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return prior.result;
 end if;
 if _reverse then
  select * into l from public.finance_payable_movement_links where tenant_id=t and id=(_payload->>'link_id')::uuid;
  if not found or l.origin<>'legacy_adoption' then raise exception 'finance_legacy_association_not_found' using errcode='22023';end if;
  if exists(select 1 from public.finance_payable_link_reversals where tenant_id=t and link_id=l.id) then raise exception 'finance_legacy_association_already_reversed' using errcode='22023';end if;
  select * into payment from public.payables_payments where tenant_id=t and id=l.payment_id;
 else
  select * into payment from public.payables_payments where tenant_id=t and id=(_payload->>'payment_id')::uuid;
 end if;
 if not found then raise exception 'finance_legacy_payment_not_found' using errcode='22023';end if;
 -- Shared order: finance -> payable -> payment -> original bank source.
 select * into title from public.payables where tenant_id=t and id=payment.payable_id for update;
 if not found then raise exception 'finance_legacy_payable_not_found' using errcode='22023';end if;
 select * into payment from public.payables_payments where tenant_id=t and id=payment.id for update;
 if not found then raise exception 'finance_legacy_payment_not_found' using errcode='22023';end if;
 if payment.bank_transaction_id is not null then perform 1 from public.bank_transactions where tenant_id=t and id=payment.bank_transaction_id for share;end if;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into actor_name from auth.users where id=actor;actor_name:=coalesce(actor_name,actor::text);
 if _reverse then
  insert into public.finance_payable_link_reversals(tenant_id,link_id,created_by,actor_name,reason) values(t,l.id,actor,actor_name,btrim(_payload->>'reason')) returning id into reversal;
  result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'link_id',l.id,'payment_id',l.payment_id,'payable_id',l.payable_id,'movement_id',l.movement_id,'reversal_id',reversal,'released_cents',l.amount_cents::text,'origin','legacy_adoption','cash_changed',false,'payment_changed',false,'confirmed',true);
 else
  if finance_private.legacy_payable_source_revision(t,payment.id) is distinct from _payload->>'revision' then raise exception 'finance_legacy_payment_changed' using errcode='40001';end if;
  issue:=finance_private.legacy_payable_payment_issue(t,payment.id);
  if issue is not null then raise exception '%',issue using errcode='23514';end if;
  cents:=(payment.amount*100)::bigint;
  select * into movement from public.finance_movements where tenant_id=t and id=(_payload->>'movement_id')::uuid;
  if not found or movement.direction<>'out' or movement.nature='transfer' then raise exception 'finance_invalid_payment_movement' using errcode='22023';end if;
  if movement.bank_account_id is distinct from payment.bank_account_id or movement.occurred_on is distinct from (payment.paid_at at time zone 'America/Sao_Paulo')::date
   or (title.driver_id is not null and title.driver_id is distinct from movement.driver_id) then raise exception 'finance_legacy_movement_mismatch' using errcode='23514';end if;
  if finance_private.movement_used_cents(t,movement.id)+cents>movement.amount_cents then raise exception 'finance_movement_overallocated' using errcode='23514';end if;
  source:=jsonb_build_object('payment',to_jsonb(payment),'payable',to_jsonb(title),'bank_transaction',(select to_jsonb(tx) from public.bank_transactions tx where tx.tenant_id=t and tx.id=payment.bank_transaction_id));
  insert into public.finance_payable_movement_links(tenant_id,movement_id,payable_id,payment_id,amount_cents,created_by,origin,reason,actor_name,source_snapshot)
  values(t,movement.id,title.id,payment.id,cents,actor,'legacy_adoption',btrim(_payload->>'reason'),actor_name,source) returning id into link;
  result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'payment_id',payment.id,'payable_id',title.id,'movement_id',movement.id,'link_id',link,'amount_cents',cents::text,'bank_transaction_id',payment.bank_transaction_id,'origin','legacy_adoption','cash_created',false,'payment_created',false,'confirmed',true);
 end if;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(t,'payable_payment',payment.id,case when _reverse then 'legacy_payable_association_reversed' else 'legacy_payable_associated' end,actor,actor_name,btrim(_payload->>'reason'),case when _reverse then to_jsonb(l) else source end,result||jsonb_build_object('manual_intervention',true));
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,action,_payload,result);return result;
end$$;
revoke all on function finance_private.manage_legacy_payable_association(jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function finance_private.manage_legacy_payable_association(jsonb,boolean) to authenticated;
create function public.associate_finance_legacy_payable_payment(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.manage_legacy_payable_association(_payload,false)$$;
create function public.reverse_finance_legacy_payable_association(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.manage_legacy_payable_association(_payload,true)$$;
revoke all on function public.associate_finance_legacy_payable_payment(jsonb),public.reverse_finance_legacy_payable_association(jsonb) from public,anon,service_role;
grant execute on function public.associate_finance_legacy_payable_payment(jsonb),public.reverse_finance_legacy_payable_association(jsonb) to authenticated;

-- Narrow patches preserve canonical semantics and the existing history envelope.
do $$declare body text;needle text;begin
 select pg_get_functiondef('finance_private.reverse_payable_link(jsonb)'::regprocedure) into body;
 needle:='if not found then raise exception ''finance_payable_link_not_found'' using errcode=''22023'';end if;';
 if position(needle in body)=0 then raise exception 'finance_payable_reversal_contract_changed';end if;
 execute replace(body,needle,needle||' if l.origin<>''canonical'' then raise exception ''finance_legacy_association_requires_own_reversal'' using errcode=''22023'';end if;');
 select pg_get_functiondef('finance_private.payable_payment_history(uuid,uuid,integer)'::regprocedure) into body;
 needle:='left join public.finance_payable_movement_links l on l.payment_id=p.id and l.tenant_id=_tenant';
 if position(needle in body)=0 then raise exception 'finance_payable_history_contract_changed';end if;
 body:=replace(body,needle,$patch$left join lateral(select l.* from public.finance_payable_movement_links l where l.payment_id=p.id and l.tenant_id=_tenant
 order by exists(select 1 from public.finance_payable_link_reversals rv where rv.tenant_id=l.tenant_id and rv.link_id=l.id),l.created_at desc,l.id desc limit 1) l on true$patch$);
 needle:='l.id link_id,l.movement_id,';
 if position(needle in body)=0 then raise exception 'finance_payable_history_contract_changed';end if;
 execute replace(body,needle,'l.id link_id,l.movement_id,l.origin link_origin,');
 select pg_get_functiondef('finance_private.legacy_adoption_candidates(uuid,uuid,date,date)'::regprocedure) into body;
 needle:='where l.tenant_id=p.tenant_id and l.payment_id=p.id)';
 if position(needle in body)=0 then raise exception 'finance_legacy_inventory_contract_changed';end if;
 body:=replace(body,needle,$patch$where l.tenant_id=p.tenant_id and l.payment_id=p.id and (l.origin='canonical' or not exists(select 1 from public.finance_payable_link_reversals rv where rv.tenant_id=l.tenant_id and rv.link_id=l.id)))$patch$);
 needle:='where l.tenant_id=pp.tenant_id and l.payment_id=pp.id)';
 if position(needle in body)=0 then raise exception 'finance_legacy_advance_inventory_contract_changed';end if;
 execute replace(body,needle,'where l.tenant_id=pp.tenant_id and l.payment_id=pp.id and l.origin=''canonical'')');
 select pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure) into body;needle:='''identity_reviewed_manually'',''identity_review_reversed''';
 if position(needle in body)=0 then raise exception 'finance_legacy_payable_audit_contract_changed';end if;
 execute replace(body,needle,'''legacy_payable_associated'',''legacy_payable_association_reversed'','||needle);
end$$;
