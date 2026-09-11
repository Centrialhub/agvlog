-- Opening balances are a reviewed cutoff, never an income movement.
create table public.finance_account_openings(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 bank_account_id uuid not null references public.bank_accounts(id),effective_from date not null,
 balance_cents bigint not null check(balance_cents between -99999999999999 and 99999999999999),
 evidence_to date not null,evidence jsonb not null,actor_id uuid not null,actor_name text not null,
 reason text not null check(length(btrim(reason)) between 10 and 2000),created_at timestamptz not null default clock_timestamp()
);
create index finance_account_opening_account on public.finance_account_openings(tenant_id,bank_account_id,created_at,id);
create table public.finance_account_opening_reversals(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 opening_id uuid not null unique references public.finance_account_openings(id),actor_id uuid not null,actor_name text not null,
 reason text not null check(length(btrim(reason)) between 10 and 2000),created_at timestamptz not null default clock_timestamp()
);
do $$declare name text;begin
 foreach name in array array['finance_account_openings','finance_account_opening_reversals'] loop
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',name);
  execute format('grant select on public.%I to authenticated,service_role',name);
  execute format('create policy finance_opening_read on public.%I for select to authenticated using(finance_private.can_access(tenant_id))',name);
  execute format('create trigger finance_opening_immutable before update or delete on public.%I for each row execute function finance_private.preserve_event()',name);
 end loop;
end$$;
create function finance_private.check_account_opening() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not finance_private.can_access(new.tenant_id) then raise exception 'finance_access_denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0));
 if not finance_private.can_access(new.tenant_id) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if not exists(select 1 from public.bank_accounts where tenant_id=new.tenant_id and id=new.bank_account_id) then raise exception 'finance_account_not_found' using errcode='22023';end if;
 if exists(select 1 from public.finance_account_openings o where o.tenant_id=new.tenant_id and o.bank_account_id=new.bank_account_id
  and not exists(select 1 from public.finance_account_opening_reversals r where r.tenant_id=new.tenant_id and r.opening_id=o.id)) then
  raise exception 'finance_account_opening_exists' using errcode='23505';end if;
 return new;
end$$;
revoke all on function finance_private.check_account_opening() from public,anon,authenticated,service_role;
create trigger finance_account_opening_active before insert on public.finance_account_openings for each row execute function finance_private.check_account_opening();

create function finance_private.manage_account_opening(_payload jsonb,_reverse boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;actor uuid:=auth.uid();actor_name text;account uuid;starts date;ends date;evidence jsonb;anchors jsonb;
 opening uuid;reversal uuid;result jsonb;action text;prior public.finance_commands%rowtype;original public.finance_account_openings%rowtype;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if request is null or _reverse is null or _payload->'version' is distinct from '1'::jsonb
  or jsonb_typeof(_payload->'reason') is distinct from 'string' or length(btrim(coalesce(_payload->>'reason',''))) not between 10 and 2000
  or exists(select 1 from jsonb_object_keys(_payload) k where k<>all(case when _reverse then array['version','tenant_id','request_id','opening_id','reason'] else array['version','tenant_id','request_id','account_id','from','to','revision','reason'] end)) then
  raise exception 'finance_invalid_payload' using errcode='22023';end if;
 action:=case when _reverse then 'reverse_account_opening' else 'record_account_opening' end;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if prior.actor_id<>actor or prior.action<>action or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;
  return prior.result;
 end if;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into actor_name from auth.users where id=actor;
 actor_name:=coalesce(actor_name,actor::text);
 if _reverse then
  select * into original from public.finance_account_openings where tenant_id=t and id=(_payload->>'opening_id')::uuid;
  if not found then raise exception 'finance_account_opening_not_found' using errcode='22023';end if;
  if exists(select 1 from public.finance_account_opening_reversals where tenant_id=t and opening_id=original.id) then raise exception 'finance_opening_already_reversed' using errcode='22023';end if;
  opening:=original.id;
  insert into public.finance_account_opening_reversals(tenant_id,opening_id,actor_id,actor_name,reason)
  values(t,opening,actor,actor_name,btrim(_payload->>'reason')) returning id into reversal;
  result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'opening_id',opening,'reversal_id',reversal,'confirmed',true,'cash_changed',false);
 else
  account:=(_payload->>'account_id')::uuid;starts:=(_payload->>'from')::date;ends:=(_payload->>'to')::date;
  if starts is null or ends is null or starts>ends or ends-starts>3660 or starts>(clock_timestamp() at time zone 'America/Sao_Paulo')::date then raise exception 'finance_invalid_period' using errcode='22023';end if;
  perform id from public.bank_accounts where tenant_id=t and id=account for share;
  if not found then raise exception 'finance_account_not_found' using errcode='22023';end if;
  if exists(select 1 from public.bank_accounts where id=account and account_type='cash') then raise exception 'finance_cash_opening_requires_count' using errcode='22023';end if;
  evidence:=finance_private.statement_period_evidence(t,account,starts,ends);
  if evidence->>'revision' is distinct from _payload->>'revision' then raise exception 'finance_opening_evidence_changed' using errcode='40001';end if;
  select coalesce(jsonb_agg(a order by a->>'import_id'),'[]') into anchors from jsonb_array_elements(evidence->'anchors') a where a->>'day'=(starts-1)::text;
  if evidence->>'opening_balance_cents' is null or jsonb_array_length(anchors)=0
   or exists(select 1 from jsonb_array_elements(anchors) a where a->>'offset_minutes' is distinct from '-180') then raise exception 'finance_opening_anchor_required' using errcode='23514';end if;
  insert into public.finance_account_openings(tenant_id,bank_account_id,effective_from,balance_cents,evidence_to,evidence,actor_id,actor_name,reason)
  values(t,account,starts,(evidence->>'opening_balance_cents')::bigint,ends,evidence||jsonb_build_object('opening_anchors',anchors),actor,actor_name,btrim(_payload->>'reason')) returning id into opening;
  result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'opening_id',opening,'confirmed',true,'cash_created',false);
 end if;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(t,'account_opening',opening,case when _reverse then 'account_opening_reversed' else 'account_opening_recorded' end,actor,actor_name,btrim(_payload->>'reason'),
  case when _reverse then to_jsonb(original) end,result||jsonb_build_object('evidence',evidence));
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,action,_payload,result);
 return result;
end$$;
revoke all on function finance_private.manage_account_opening(jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function finance_private.manage_account_opening(jsonb,boolean) to authenticated;
create function public.record_finance_account_opening(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.manage_account_opening(_payload,false)$$;
create function public.reverse_finance_account_opening(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.manage_account_opening(_payload,true)$$;
revoke all on function public.record_finance_account_opening(jsonb),public.reverse_finance_account_opening(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_finance_account_opening(jsonb),public.reverse_finance_account_opening(jsonb) to authenticated;

create function finance_private.account_opening(_tenant uuid,_account uuid,_from date,_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o public.finance_account_openings%rowtype;active jsonb;book jsonb;history jsonb;evidence jsonb;valid boolean;prior_net numeric;incoming numeric;outgoing numeric;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _from is null or _to is null or _from>_to or _to-_from>3660 then raise exception 'finance_invalid_period' using errcode='22023';end if;
 if not exists(select 1 from public.bank_accounts where tenant_id=_tenant and id=_account) then raise exception 'finance_account_not_found' using errcode='22023';end if;
 select * into o from public.finance_account_openings a where a.tenant_id=_tenant and a.bank_account_id=_account
  and not exists(select 1 from public.finance_account_opening_reversals r where r.tenant_id=_tenant and r.opening_id=a.id);
 if found then
  evidence:=finance_private.statement_period_evidence(_tenant,_account,o.effective_from,o.evidence_to);
  valid:=evidence->>'opening_balance_cents'=o.balance_cents::text and not exists(select 1 from jsonb_array_elements(o.evidence->'opening_anchors') saved
   where not exists(select 1 from jsonb_array_elements(evidence->'anchors') current_anchor where current_anchor=saved));
  active:=jsonb_build_object('id',o.id,'effective_from',o.effective_from,'balance_cents',o.balance_cents::text,'actor_id',o.actor_id,'actor_name',o.actor_name,'reason',o.reason,'created_at',o.created_at,'evidence_status',case when coalesce(valid,false) then 'valid' else 'requires_review' end);
  if _from>=o.effective_from then
   select coalesce(sum(case when direction='in' then amount_cents else -amount_cents end),0) into prior_net from public.finance_movements
    where tenant_id=_tenant and bank_account_id=_account and occurred_on>=o.effective_from and occurred_on<_from;
   select coalesce(sum(amount_cents) filter(where direction='in'),0),coalesce(sum(amount_cents) filter(where direction='out'),0) into incoming,outgoing
    from public.finance_movements where tenant_id=_tenant and bank_account_id=_account and occurred_on between _from and _to;
   book:=jsonb_build_object('opening_cents',(o.balance_cents+prior_net)::text,'in_cents',incoming::text,'out_cents',outgoing::text,'closing_cents',(o.balance_cents+prior_net+incoming-outgoing)::text);
  end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'effective_from',a.effective_from,'balance_cents',a.balance_cents::text,'actor_id',a.actor_id,'actor_name',a.actor_name,'reason',a.reason,'created_at',a.created_at,
  'reversal',case when r.id is null then null else jsonb_build_object('id',r.id,'actor_id',r.actor_id,'actor_name',r.actor_name,'reason',r.reason,'created_at',r.created_at) end) order by a.created_at,a.id),'[]') into history
  from public.finance_account_openings a left join public.finance_account_opening_reversals r on r.tenant_id=_tenant and r.opening_id=a.id where a.tenant_id=_tenant and a.bank_account_id=_account;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'account_id',_account,'from',_from,'to',_to,'opening',active,'book',book,'history',history,'can_close',false);
end$$;
revoke all on function finance_private.account_opening(uuid,uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function finance_private.account_opening(uuid,uuid,date,date) to authenticated;
create function public.get_finance_account_opening(_tenant_id uuid,_account_id uuid,_from date,_to date) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.account_opening(_tenant_id,_account_id,_from,_to)$$;
revoke all on function public.get_finance_account_opening(uuid,uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_account_opening(uuid,uuid,date,date) to authenticated;

do $$declare body text;needle text:='''identity_reviewed_manually'',''identity_review_reversed''';begin
 select pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure) into body;
 if position(needle in body)=0 then raise exception 'finance_opening_audit_contract_changed';end if;
 execute replace(body,needle,'''account_opening_recorded'',''account_opening_reversed'','||needle);
end$$;
