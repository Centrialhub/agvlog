create table public.finance_reconciliation_groups(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 bank_account_id uuid not null references public.bank_accounts(id),direction text not null check(direction in('in','out')),
 amount_cents bigint not null check(amount_cents between 1 and 99999999999999),
 movement_ids uuid[] not null check(cardinality(movement_ids) between 1 and 100),
 bank_entry_ids uuid[] not null check(cardinality(bank_entry_ids) between 1 and 100),
 method text not null check(method='manual'),actor_id uuid not null,actor_name text not null,
 reason text not null check(length(btrim(reason)) between 10 and 2000),account_evidence text not null check(length(btrim(account_evidence)) between 10 and 2000),
 evidence_snapshot jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(tenant_id,id)
);
create table public.finance_reconciliation_reversals(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,group_id uuid not null,
 actor_id uuid not null,actor_name text not null,reason text not null check(length(btrim(reason)) between 10 and 2000),
 created_at timestamptz not null default clock_timestamp(),unique(tenant_id,group_id),
 foreign key(tenant_id,group_id) references public.finance_reconciliation_groups(tenant_id,id)
);
create index finance_reconciliation_movements on public.finance_reconciliation_groups using gin(movement_ids);
create index finance_reconciliation_entries on public.finance_reconciliation_groups using gin(bank_entry_ids);
do $$declare tbl text;begin
 foreach tbl in array array['finance_reconciliation_groups','finance_reconciliation_reversals'] loop
  execute format('alter table public.%I enable row level security',tbl);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',tbl);
  execute format('grant select on public.%I to authenticated,service_role',tbl);
  execute format('create policy finance_internal_read on public.%I for select to authenticated using(finance_private.can_access(tenant_id))',tbl);
  execute format('create trigger finance_immutable before update or delete on public.%I for each row execute function finance_private.preserve_event()',tbl);
 end loop;
end;$$;

create function finance_private.reconciliation_context(_tenant uuid,_movements uuid[],_entries uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare snapshot jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if coalesce(cardinality(_movements),0) not between 1 and 100 or coalesce(cardinality(_entries),0) not between 1 and 100
  or cardinality(_movements)<>(select count(distinct id) from unnest(_movements) id)
  or cardinality(_entries)<>(select count(distinct id) from unnest(_entries) id) then raise exception 'finance_invalid_reconciliation_selection' using errcode='22023';end if;
 if (select count(*) from public.finance_movements where tenant_id=_tenant and id=any(_movements))<>cardinality(_movements)
  or (select count(*) from public.finance_bank_entries where tenant_id=_tenant and id=any(_entries))<>cardinality(_entries) then
  raise exception 'finance_reconciliation_selection_unavailable' using errcode='22023';end if;
 snapshot:=jsonb_build_object('version',1,'tenant_id',_tenant,
  'accounts',(select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'bank_code',to_jsonb(a)->'bank_code',
    'bank_name',to_jsonb(a)->'bank_name','branch_number',to_jsonb(a)->'branch_number','account_number',to_jsonb(a)->'account_number',
    'account_type',to_jsonb(a)->'account_type') order by a.id) from public.bank_accounts a where a.tenant_id=_tenant and a.id in(
     select bank_account_id from public.finance_movements where tenant_id=_tenant and id=any(_movements)
     union select bank_account_id from public.finance_bank_entries where tenant_id=_tenant and id=any(_entries))),
  'movements',(select jsonb_agg(to_jsonb(m) order by m.id) from public.finance_movements m where m.tenant_id=_tenant and m.id=any(_movements)),
  'entries',(select jsonb_agg(to_jsonb(e)||jsonb_build_object('active',finance_private.bank_entry_active(_tenant,e.id),
    'source_verification', (select to_jsonb(v) from public.finance_statement_verifications v where v.tenant_id=_tenant and v.import_id=e.first_import_id order by v.created_at desc,v.id desc limit 1)) order by e.id)
   from public.finance_bank_entries e where e.tenant_id=_tenant and e.id=any(_entries)),
  'history',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('reversal_id',r.id) order by g.id)
   from public.finance_reconciliation_groups g left join public.finance_reconciliation_reversals r on r.tenant_id=g.tenant_id and r.group_id=g.id
   where g.tenant_id=_tenant and (g.movement_ids&&_movements or g.bank_entry_ids&&_entries)),'[]'));
 return snapshot||jsonb_build_object('revision',md5(snapshot::text));
end;$$;
revoke all on function finance_private.reconciliation_context(uuid,uuid[],uuid[]) from public,anon,authenticated,service_role;
create function public.get_finance_reconciliation_context(_tenant_id uuid,_movement_ids uuid[],_bank_entry_ids uuid[]) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.reconciliation_context(_tenant_id,_movement_ids,_bank_entry_ids);$$;
revoke all on function public.get_finance_reconciliation_context(uuid,uuid[],uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_reconciliation_context(uuid,uuid[],uuid[]),finance_private.reconciliation_context(uuid,uuid[],uuid[]) to authenticated;

create function finance_private.reconcile_bank_group(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;actor uuid:=auth.uid();actor_name text;existing public.finance_commands%rowtype;
 movements uuid[];entries uuid[];snapshot jsonb;item jsonb;account uuid;direction text;movement_total numeric;entry_total numeric;
 group_id uuid:=gen_random_uuid();result jsonb;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if request is null or _payload->>'version' is distinct from '1' or jsonb_typeof(_payload->'movement_ids') is distinct from 'array'
  or jsonb_typeof(_payload->'bank_entry_ids') is distinct from 'array' or length(btrim(coalesce(_payload->>'reason',''))) not between 10 and 2000
  or length(btrim(coalesce(_payload->>'account_evidence',''))) not between 10 and 2000
  or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','movement_ids','bank_entry_ids','expected_revision','reason','account_evidence')) then
  raise exception 'finance_invalid_reconciliation' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 select * into existing from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if existing.actor_id<>actor or existing.action<>'reconcile_bank_group' or existing.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;
  return existing.result;
 end if;
 select array_agg(value::uuid) into movements from jsonb_array_elements_text(_payload->'movement_ids');
 select array_agg(value::uuid) into entries from jsonb_array_elements_text(_payload->'bank_entry_ids');
 snapshot:=finance_private.reconciliation_context(t,movements,entries);
 if snapshot->>'revision' is distinct from _payload->>'expected_revision' then raise exception 'finance_reconciliation_context_changed' using errcode='40001';end if;
 if exists(select 1 from jsonb_array_elements(snapshot->'history') h where h->>'reversal_id' is null) then
  raise exception 'finance_reconciliation_already_linked' using errcode='23514';end if;
 account:=(snapshot#>>'{movements,0,bank_account_id}')::uuid;direction:=snapshot#>>'{movements,0,direction}';
 perform 1 from public.bank_accounts a where a.tenant_id=t and a.id=account and to_jsonb(a)->>'account_type' is distinct from 'cash' for share;
 if not found then raise exception 'finance_reconciliation_bank_account_required' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(snapshot->'movements') loop
  if (item->>'bank_account_id')::uuid<>account or item->>'direction'<>direction then raise exception 'finance_reconciliation_account_or_direction_mismatch' using errcode='22023';end if;
 end loop;
 for item in select value from jsonb_array_elements(snapshot->'entries') loop
  if (item->>'bank_account_id')::uuid<>account or ((item->>'amount_cents')::bigint>0)<>(direction='in') then
   raise exception 'finance_reconciliation_account_or_direction_mismatch' using errcode='22023';end if;
  if item->>'active' is distinct from 'true' or item#>>'{source_verification,outcome}' is distinct from 'rows_match' then
   raise exception 'finance_reconciliation_source_not_verified' using errcode='22023';end if;
 end loop;
 select sum((m->>'amount_cents')::numeric) into movement_total from jsonb_array_elements(snapshot->'movements') m;
 select sum(abs((e->>'amount_cents')::numeric)) into entry_total from jsonb_array_elements(snapshot->'entries') e;
 if movement_total<>entry_total or movement_total not between 1 and 99999999999999 then raise exception 'finance_reconciliation_amount_mismatch' using errcode='22023';end if;
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into actor_name from auth.users where id=actor;
 insert into public.finance_reconciliation_groups(id,tenant_id,bank_account_id,direction,amount_cents,movement_ids,bank_entry_ids,method,actor_id,actor_name,reason,account_evidence,evidence_snapshot)
 values(group_id,t,account,direction,movement_total,movements,entries,'manual',actor,coalesce(actor_name,actor::text),btrim(_payload->>'reason'),btrim(_payload->>'account_evidence'),snapshot);
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'group_id',group_id,'amount_cents',movement_total::text,'manual',true,'confirmed',true);
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data)
 values(t,'reconciliation_group',group_id,'bank_reconciled_manually',actor,coalesce(actor_name,actor::text),btrim(_payload->>'reason'),result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'reconcile_bank_group',_payload,result);
 return result;
end;$$;
revoke all on function finance_private.reconcile_bank_group(jsonb) from public,anon,authenticated,service_role;
create function public.reconcile_finance_bank_group(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.reconcile_bank_group(_payload);$$;
revoke all on function public.reconcile_finance_bank_group(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.reconcile_finance_bank_group(jsonb),finance_private.reconcile_bank_group(jsonb) to authenticated;

create function finance_private.reverse_bank_reconciliation(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;actor uuid:=auth.uid();actor_name text;g public.finance_reconciliation_groups%rowtype;
 existing public.finance_commands%rowtype;reversal uuid;result jsonb;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if request is null or _payload->>'version' is distinct from '1' or nullif(_payload->>'group_id','') is null
  or length(btrim(coalesce(_payload->>'reason',''))) not between 10 and 2000
  or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','group_id','reason')) then
  raise exception 'finance_invalid_reconciliation_reversal' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 select * into existing from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if existing.actor_id<>actor or existing.action<>'reverse_bank_reconciliation' or existing.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;
  return existing.result;
 end if;
 select * into g from public.finance_reconciliation_groups where tenant_id=t and id=(_payload->>'group_id')::uuid;
 if not found then raise exception 'finance_reconciliation_not_found' using errcode='22023';end if;
 if exists(select 1 from public.finance_reconciliation_reversals where tenant_id=t and group_id=g.id) then raise exception 'finance_reconciliation_already_reversed' using errcode='40001';end if;
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into actor_name from auth.users where id=actor;
 insert into public.finance_reconciliation_reversals(tenant_id,group_id,actor_id,actor_name,reason)
 values(t,g.id,actor,coalesce(actor_name,actor::text),btrim(_payload->>'reason')) returning id into reversal;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'group_id',g.id,'reversal_id',reversal,'manual',true,'confirmed',true);
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(t,'reconciliation_group',g.id,'bank_reconciliation_reversed',actor,coalesce(actor_name,actor::text),btrim(_payload->>'reason'),to_jsonb(g),result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'reverse_bank_reconciliation',_payload,result);
 return result;
end;$$;
revoke all on function finance_private.reverse_bank_reconciliation(jsonb) from public,anon,authenticated,service_role;
create function public.reverse_finance_bank_reconciliation(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.reverse_bank_reconciliation(_payload);$$;
revoke all on function public.reverse_finance_bank_reconciliation(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.reverse_finance_bank_reconciliation(jsonb),finance_private.reverse_bank_reconciliation(jsonb) to authenticated;

-- A reviewed bank identity cannot disappear while an active match relies on it.
do $$declare body text;original text;begin
 select pg_get_functiondef('finance_private.reverse_identity_review(jsonb)'::regprocedure) into body;
 original:='if ir.decision=''distinct_transaction'' and (';
 if position(original in body)=0 then raise exception 'finance_reconciliation_dependency_contract_changed';end if;
 execute replace(body,original,$new$if exists(select 1 from public.finance_reconciliation_groups g where g.tenant_id=t and ir.bank_entry_id=any(g.bank_entry_ids)
  and not exists(select 1 from public.finance_reconciliation_reversals rv where rv.tenant_id=t and rv.group_id=g.id)) then
  raise exception 'finance_identity_review_has_dependents' using errcode='23514';end if;
 if ir.decision='distinct_transaction' and ($new$);
 select pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure) into body;
 execute replace(body,'''identity_reviewed_manually'',''identity_review_reversed''','''identity_reviewed_manually'',''identity_review_reversed'',''bank_reconciled_manually'',''bank_reconciliation_reversed''');
end;$$;
