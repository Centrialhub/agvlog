create table public.finance_account_period_closures(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,account_id uuid not null,
 period_start date not null,period_end date not null,opening_id uuid not null,predecessor_id uuid,previous_closure_id uuid,
 snapshot jsonb not null,snapshot_revision text not null,actor_id uuid not null,actor_name text not null,
 reason text not null check(length(btrim(reason)) between 10 and 2000),request_id uuid not null,created_at timestamptz not null default clock_timestamp(),
 check(isfinite(period_start) and isfinite(period_end) and period_end>=period_start and period_end-period_start<366),unique(tenant_id,id),unique(tenant_id,request_id),
 foreign key(tenant_id,predecessor_id) references public.finance_account_period_closures(tenant_id,id),foreign key(tenant_id,previous_closure_id) references public.finance_account_period_closures(tenant_id,id)
);
create index finance_account_closure_period on public.finance_account_period_closures(tenant_id,account_id,period_start,period_end);
create table public.finance_account_period_reopenings(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,closure_id uuid not null,expected_snapshot_revision text not null,
 actor_id uuid not null,actor_name text not null,reason text not null check(length(btrim(reason)) between 10 and 2000),request_id uuid not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,closure_id),unique(tenant_id,request_id),foreign key(tenant_id,closure_id) references public.finance_account_period_closures(tenant_id,id)
);
create table public.finance_account_period_dependencies(
 tenant_id uuid not null,closure_id uuid not null,source_kind text not null,source_id uuid not null,source_revision text not null,account_id uuid,
 affected_from date,affected_to date,dependency_role text not null check(dependency_role in('money','bank_evidence','opening','predecessor','legacy_review','composition_snapshot')),
 primary key(tenant_id,closure_id,source_kind,source_id),foreign key(tenant_id,closure_id) references public.finance_account_period_closures(tenant_id,id)
);
create index finance_closed_source_dependency on public.finance_account_period_dependencies(tenant_id,source_kind,source_id);
create table finance_private.account_close_write_tickets(transaction_id bigint not null,tenant_id uuid not null,request_id uuid not null,actor_id uuid not null,operation text not null,primary key(transaction_id,tenant_id,request_id));
revoke all on finance_private.account_close_write_tickets from public,anon,authenticated,service_role;
do $$declare t text;begin foreach t in array array['finance_account_period_closures','finance_account_period_reopenings','finance_account_period_dependencies'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy finance_period_close_read on public.%I for select to authenticated using(finance_private.can_access(tenant_id))',t);
 execute format('create trigger finance_period_close_immutable before update or delete on public.%I for each row execute function finance_private.preserve_event()',t);
end loop;end$$;
create function finance_private.can_close_account_period(_tenant uuid) returns boolean language sql stable security definer set search_path='' as $$
select finance_private.can_access(_tenant) and exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and m.role::text in('owner','admin'))$$;
revoke all on function finance_private.can_close_account_period(uuid) from public,anon,authenticated,service_role;

create function finance_private.validate_closure_insert() returns trigger language plpgsql security definer set search_path='' as $$
declare previous public.finance_account_period_closures%rowtype;begin
 if not finance_private.can_close_account_period(new.tenant_id) then raise exception 'finance_close_access_denied' using errcode='42501';end if;
 if not pg_try_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0)) then raise exception 'finance_period_close_busy' using errcode='40001';end if;
 delete from finance_private.account_close_write_tickets where transaction_id=txid_current() and tenant_id=new.tenant_id and request_id=new.request_id and actor_id=auth.uid() and operation=tg_table_name;
 if not found then raise exception 'finance_period_close_command_required' using errcode='42501';end if;
 if tg_table_name='finance_account_period_closures' then
  if new.period_end>=(clock_timestamp() at time zone 'America/Sao_Paulo')::date then raise exception 'finance_period_not_ended' using errcode='23514';end if;
  if exists(select 1 from public.finance_account_period_closures c where c.tenant_id=new.tenant_id and c.account_id=new.account_id and c.period_start<=new.period_end and c.period_end>=new.period_start and not exists(select 1 from public.finance_account_period_reopenings r where r.tenant_id=c.tenant_id and r.closure_id=c.id)) then raise exception 'finance_period_already_closed' using errcode='23514';end if;
  select c.* into previous from public.finance_account_period_closures c where c.tenant_id=new.tenant_id and c.account_id=new.account_id and not exists(select 1 from public.finance_account_period_reopenings r where r.tenant_id=c.tenant_id and r.closure_id=c.id) order by c.period_end desc limit 1;
  if found then
   if new.predecessor_id is distinct from previous.id or new.opening_id is distinct from previous.opening_id or new.period_start is distinct from previous.period_end+1 then raise exception 'finance_period_not_contiguous' using errcode='23514';end if;
  elsif new.predecessor_id is not null or not exists(select 1 from public.finance_account_openings o where o.id=new.opening_id and o.tenant_id=new.tenant_id and o.bank_account_id=new.account_id and o.effective_from=new.period_start and not exists(select 1 from public.finance_account_opening_reversals r where r.tenant_id=o.tenant_id and r.opening_id=o.id)) then raise exception 'finance_period_opening_mismatch' using errcode='23514';end if;
 else
  if exists(select 1 from public.finance_account_period_closures c where c.tenant_id=new.tenant_id and c.predecessor_id=new.closure_id and not exists(select 1 from public.finance_account_period_reopenings r where r.tenant_id=c.tenant_id and r.closure_id=c.id)) then raise exception 'finance_period_has_descendants' using errcode='23514';end if;
 end if;
 return new;
end$$;
revoke all on function finance_private.validate_closure_insert() from public,anon,authenticated,service_role;
create trigger finance_validate_closure before insert on public.finance_account_period_closures for each row execute function finance_private.validate_closure_insert();
create trigger finance_validate_reopening before insert on public.finance_account_period_reopenings for each row execute function finance_private.validate_closure_insert();

create function finance_private.manage_account_period_close(_payload jsonb,_reopen boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;actor uuid:=auth.uid();account uuid;start_date date;end_date date;action text;reason text;actor_name text;prior public.finance_commands%rowtype;c public.finance_account_period_closures%rowtype;snapshot jsonb;result jsonb;newid uuid;previous_id uuid;dep jsonb;
begin
 if jsonb_typeof(_payload) is distinct from 'object' or _payload->'version' is distinct from '1'::jsonb or jsonb_typeof(_payload->'reason') is distinct from 'string' or length(btrim(_payload->>'reason')) not between 10 and 2000 or coalesce(_payload->>'revision','') !~ '^[0-9a-f]{32,64}$'
 or exists(select 1 from jsonb_object_keys(_payload) k where k<>all(case when _reopen then array['version','tenant_id','request_id','closure_id','revision','reason'] else array['version','tenant_id','request_id','account_id','from','to','revision','reason'] end)) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;reason:=btrim(_payload->>'reason');
 if t is null or request is null then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if not _reopen and (jsonb_typeof(_payload->'from') is distinct from 'string' or jsonb_typeof(_payload->'to') is distinct from 'string' or coalesce(_payload->>'from','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(_payload->>'to','') !~ '^\d{4}-\d{2}-\d{2}$') then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if not finance_private.can_close_account_period(t) then raise exception 'finance_close_access_denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_close_account_period(t) then raise exception 'finance_close_access_denied' using errcode='42501';end if;
 action:=case when _reopen then 'reopen_account_period' else 'close_account_period' end;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;
 if found then if prior.actor_id<>actor or prior.action<>action or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return prior.result;end if;
 if _reopen then
  select * into c from public.finance_account_period_closures where tenant_id=t and id=(_payload->>'closure_id')::uuid;
  if not found then raise exception 'finance_period_closure_not_found' using errcode='22023';end if;account:=c.account_id;
 else account:=(_payload->>'account_id')::uuid;start_date:=(_payload->>'from')::date;end_date:=(_payload->>'to')::date;end if;
 if account is null then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform 1 from public.bank_accounts where tenant_id=t order by id for update;
 if not finance_private.can_close_account_period(t) then raise exception 'finance_close_access_denied' using errcode='42501';end if;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into actor_name from auth.users where id=actor;actor_name:=coalesce(actor_name,actor::text);
 if _reopen then
  if c.snapshot_revision is distinct from _payload->>'revision' then raise exception 'finance_period_close_changed' using errcode='40001';end if;
  if exists(select 1 from public.finance_account_period_reopenings where tenant_id=t and closure_id=c.id) then raise exception 'finance_period_already_reopened' using errcode='23514';end if;
  insert into finance_private.account_close_write_tickets values(txid_current(),t,request,actor,'finance_account_period_reopenings');
  insert into public.finance_account_period_reopenings(tenant_id,closure_id,expected_snapshot_revision,actor_id,actor_name,reason,request_id) values(t,c.id,c.snapshot_revision,actor,actor_name,reason,request) returning id into newid;
  result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'account_id',account,'closure_id',c.id,'reopening_id',newid,'confirmed',true,'cash_changed',false);
 else
  if start_date is null or end_date is null or not isfinite(start_date) or not isfinite(end_date) or end_date<start_date or end_date-start_date>=366 then raise exception 'finance_invalid_filters' using errcode='22023';end if;
  snapshot:=finance_private.account_period_close_snapshot(t,account,start_date,end_date);
  if snapshot->>'revision' is distinct from _payload->>'revision' then raise exception 'finance_period_close_changed' using errcode='40001';end if;
  if snapshot->'eligible' is distinct from 'true'::jsonb or not finance_private.account_period_guards_ready() then raise exception 'finance_period_close_blocked' using errcode='23514';end if;
  if jsonb_typeof(snapshot->'dependencies') is distinct from 'array' or not exists(select 1 from jsonb_array_elements(snapshot->'dependencies') d where d->>'source_kind'='finance_account_openings' and d->>'source_id'=snapshot->>'opening_id') then raise exception 'finance_period_dependencies_incomplete' using errcode='23514';end if;
  select old.id into previous_id from public.finance_account_period_closures old where old.tenant_id=t and old.account_id=account and old.period_start=start_date and old.period_end=end_date order by old.created_at desc,old.id desc limit 1;
  insert into finance_private.account_close_write_tickets values(txid_current(),t,request,actor,'finance_account_period_closures');
  insert into public.finance_account_period_closures(tenant_id,account_id,period_start,period_end,opening_id,predecessor_id,previous_closure_id,snapshot,snapshot_revision,actor_id,actor_name,reason,request_id)
  values(t,account,start_date,end_date,(snapshot->>'opening_id')::uuid,(snapshot->>'predecessor_id')::uuid,previous_id,snapshot,snapshot->>'revision',actor,actor_name,reason,request) returning * into c;
  for dep in select value from jsonb_array_elements(snapshot->'dependencies') loop
   insert into public.finance_account_period_dependencies values(t,c.id,dep->>'source_kind',(dep->>'source_id')::uuid,dep->>'source_revision',(dep->>'account_id')::uuid,(dep->>'affected_from')::date,(dep->>'affected_to')::date,dep->>'dependency_role');
  end loop;
  result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'account_id',account,'closure_id',c.id,'from',start_date,'to',end_date,'revision',c.snapshot_revision,'confirmed',true,'cash_changed',false);
 end if;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(t,'account_period',c.id,case when _reopen then 'account_period_reopened' else 'account_period_closed' end,actor,actor_name,reason,c.snapshot,result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,action,_payload,result);return result;
end$$;
revoke all on function finance_private.manage_account_period_close(jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function finance_private.manage_account_period_close(jsonb,boolean) to authenticated;
create function public.close_finance_account_period(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.manage_account_period_close(_payload,false)$$;
create function public.reopen_finance_account_period(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.manage_account_period_close(_payload,true)$$;
revoke all on function public.close_finance_account_period(jsonb),public.reopen_finance_account_period(jsonb) from public,anon,service_role;
grant execute on function public.close_finance_account_period(jsonb),public.reopen_finance_account_period(jsonb) to authenticated;
