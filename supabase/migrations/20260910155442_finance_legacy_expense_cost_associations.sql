create table public.finance_legacy_expense_cost_links(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,expense_id uuid not null,cost_id uuid not null,
 amount_cents bigint not null check(amount_cents>0 and amount_cents<=99999999999999),actor_id uuid not null,actor_name text not null,
 reason text not null check(length(btrim(reason)) between 10 and 2000),source_snapshot jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(tenant_id,id)
);
create index finance_legacy_cost_expense on public.finance_legacy_expense_cost_links(tenant_id,expense_id);
create index finance_legacy_cost_target on public.finance_legacy_expense_cost_links(tenant_id,cost_id);
create table public.finance_legacy_expense_cost_reversals(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,link_id uuid not null,actor_id uuid not null,actor_name text not null,
 reason text not null check(length(btrim(reason)) between 10 and 2000),created_at timestamptz not null default clock_timestamp(),unique(tenant_id,link_id),
 foreign key(tenant_id,link_id) references public.finance_legacy_expense_cost_links(tenant_id,id)
);
do $$declare t text;begin foreach t in array array['finance_legacy_expense_cost_links','finance_legacy_expense_cost_reversals'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy finance_cost_source_read on public.%I for select to authenticated using(finance_private.can_access(tenant_id))',t);
 execute format('create trigger preserve_finance_cost_source before update or delete on public.%I for each row execute function finance_private.preserve_event()',t);
end loop;end$$;

create function finance_private.legacy_expense_source_issue(_tenant uuid,_expense uuid) returns text
language plpgsql stable set search_path='' as $$declare e public.driver_expenses%rowtype;begin
 select * into e from public.driver_expenses where tenant_id=_tenant and id=_expense;
 if not found then return 'finance_legacy_expense_not_found';end if;
 if e.approval_status is distinct from 'approved' then return 'finance_legacy_expense_not_approved';end if;
 if e.reimbursable is distinct from false or e.payment_source is null or e.payment_source='driver' then return 'finance_legacy_expense_reimbursement_requires_review';end if;
 if e.driver_id is null or e.dispatch_trip_id is null or not exists(select 1 from public.dispatch_trips t where t.tenant_id=_tenant and t.id=e.dispatch_trip_id and t.driver_id=e.driver_id) then return 'finance_legacy_expense_trip_mismatch';end if;
 if e.amount is null or not(e.amount>0 and e.amount*100=trunc(e.amount*100) and e.amount*100<=99999999999999) or e.expense_at is null or not isfinite(e.expense_at) then return 'finance_legacy_expense_invalid_value';end if;
 return null;
end$$;
create function finance_private.legacy_expense_protected_issue(_tenant uuid,_expense uuid) returns text
language plpgsql stable set search_path='' as $$declare e public.driver_expenses%rowtype;begin
 select * into e from public.driver_expenses where tenant_id=_tenant and id=_expense;
 if exists(select 1 from public.driver_settlements s where s.tenant_id=_tenant and s.dispatch_trip_id=e.dispatch_trip_id and s.status not in('pending_review','in_review','reopened')) then return 'finance_legacy_cost_settlement_protected';end if;
 if exists(select 1 from public.payroll_entries pe join public.payroll_periods pp on pp.tenant_id=pe.tenant_id and pp.id=pe.payroll_period_id
  where pe.tenant_id=_tenant and (pe.driver_id=e.driver_id and (e.expense_at at time zone 'America/Sao_Paulo')::date between pp.period_start and pp.period_end
   or exists(select 1 from public.payroll_entry_items x where x.tenant_id=_tenant and x.payroll_entry_id=pe.id and ((x.source_table='driver_expenses' and x.source_id=e.id)
    or(x.source_table='driver_settlements' and exists(select 1 from public.driver_settlements s where s.tenant_id=_tenant and s.id=x.source_id and s.dispatch_trip_id=e.dispatch_trip_id)))))
  and (pe.status not in('draft','calculated') or pp.status not in('draft','calculated'))) then return 'finance_legacy_cost_payroll_protected';end if;
 return null;
end$$;
create function finance_private.legacy_expense_cost_issue(_tenant uuid,_expense uuid,_cost uuid) returns text
language plpgsql stable set search_path='' as $$declare e public.driver_expenses%rowtype;c public.finance_expense_items%rowtype;b public.finance_expense_batches%rowtype;issue text;begin
 issue:=finance_private.legacy_expense_source_issue(_tenant,_expense);if issue is not null then return issue;end if;
 select * into e from public.driver_expenses where tenant_id=_tenant and id=_expense;
 select * into c from public.finance_expense_items where tenant_id=_tenant and id=_cost;
 if not found then return 'finance_legacy_cost_not_found';end if;
 select * into b from public.finance_expense_batches where tenant_id=_tenant and id=c.batch_id;
 if not found or b.context<>'trip' or b.trip_id is distinct from e.dispatch_trip_id or b.driver_id is distinct from e.driver_id then return 'finance_legacy_cost_trip_mismatch';end if;
 if c.amount_cents::numeric<>e.amount*100 or c.category is distinct from e.category or c.occurred_on is distinct from (e.expense_at at time zone 'America/Sao_Paulo')::date then return 'finance_legacy_cost_source_mismatch';end if;
 if exists(select 1 from public.finance_legacy_expense_cost_links l where l.tenant_id=_tenant and (l.expense_id=e.id or l.cost_id=c.id) and not exists(select 1 from public.finance_legacy_expense_cost_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id)) then return 'finance_legacy_cost_already_associated';end if;
 if exists(select 1 from public.payables p where p.tenant_id=_tenant and p.id is distinct from c.payable_id and ((p.source_table='driver_expenses' and p.source_id=e.id)
  or(p.source_table='financial_obligations' and exists(select 1 from public.financial_obligations o where o.tenant_id=_tenant and o.id=p.source_id and o.source_table='driver_expenses' and o.source_id=e.id)))) then return 'finance_legacy_cost_obligation_conflict';end if;
 return finance_private.legacy_expense_protected_issue(_tenant,_expense);
end$$;
create function finance_private.legacy_expense_cost_snapshot(_tenant uuid,_expense uuid,_cost uuid) returns jsonb
language sql stable set search_path='' as $$select jsonb_build_object(
 'expense',(select to_jsonb(e) from public.driver_expenses e where e.tenant_id=_tenant and e.id=_expense),
 'cost',(select to_jsonb(c) from public.finance_expense_items c where c.tenant_id=_tenant and c.id=_cost),
 'batch',(select to_jsonb(b) from public.finance_expense_batches b join public.finance_expense_items c on c.tenant_id=b.tenant_id and c.batch_id=b.id where c.tenant_id=_tenant and c.id=_cost),
 'obligations',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from public.financial_obligations o where o.tenant_id=_tenant and o.source_table='driver_expenses' and o.source_id=_expense),
 'allocations',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') from public.finance_expense_allocations a where a.tenant_id=_tenant and a.expense_id=_cost),
 'payables',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.payables p where p.tenant_id=_tenant and (p.id=(select c.payable_id from public.finance_expense_items c where c.tenant_id=_tenant and c.id=_cost) or(p.source_table='driver_expenses' and p.source_id=_expense)
  or(p.source_table='financial_obligations' and exists(select 1 from public.financial_obligations o where o.tenant_id=_tenant and o.id=p.source_id and o.source_table='driver_expenses' and o.source_id=_expense)))),
 'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.payables_payments p join public.payables title on title.tenant_id=p.tenant_id and title.id=p.payable_id where p.tenant_id=_tenant and (title.id=(select c.payable_id from public.finance_expense_items c where c.tenant_id=_tenant and c.id=_cost) or(title.source_table='driver_expenses' and title.source_id=_expense))),
 'settlements',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.driver_settlements s where s.tenant_id=_tenant and s.dispatch_trip_id=(select e.dispatch_trip_id from public.driver_expenses e where e.tenant_id=_tenant and e.id=_expense)),
 'payroll',(select coalesce(jsonb_agg(jsonb_build_object('entry',to_jsonb(pe),'period',to_jsonb(pp),'items',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.payroll_entry_items x where x.tenant_id=_tenant and x.payroll_entry_id=pe.id)) order by pe.id),'[]') from public.payroll_entries pe join public.payroll_periods pp on pp.tenant_id=pe.tenant_id and pp.id=pe.payroll_period_id where pe.tenant_id=_tenant and (pe.driver_id=(select e.driver_id from public.driver_expenses e where e.tenant_id=_tenant and e.id=_expense)
  or exists(select 1 from public.payroll_entry_items x where x.tenant_id=_tenant and x.payroll_entry_id=pe.id and x.source_table='driver_expenses' and x.source_id=_expense))),
 'links',(select coalesce(jsonb_agg(jsonb_build_object('link',to_jsonb(l),'reversal',(select to_jsonb(r) from public.finance_legacy_expense_cost_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id)) order by l.id),'[]') from public.finance_legacy_expense_cost_links l where l.tenant_id=_tenant and (l.expense_id=_expense or l.cost_id=_cost))
 )$$;
create function finance_private.legacy_expense_cost_revision(_tenant uuid,_expense uuid,_cost uuid) returns text language sql stable set search_path='' as $$select md5(finance_private.legacy_expense_cost_snapshot(_tenant,_expense,_cost)::text)$$;
revoke all on function finance_private.legacy_expense_cost_snapshot(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function finance_private.legacy_expense_source_issue(uuid,uuid),finance_private.legacy_expense_protected_issue(uuid,uuid),finance_private.legacy_expense_cost_issue(uuid,uuid,uuid),finance_private.legacy_expense_cost_revision(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.manage_legacy_expense_cost(_payload jsonb,_reverse boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;actor uuid:=auth.uid();actor_name text;expense uuid;cost uuid;trip uuid;reason text;action text;issue text;result jsonb;prior public.finance_commands%rowtype;l public.finance_legacy_expense_cost_links%rowtype;reversal uuid;snapshot jsonb;
begin
 if jsonb_typeof(_payload) is distinct from 'object' or _payload->'version' is distinct from '1'::jsonb or jsonb_typeof(_payload->'reason') is distinct from 'string'
  or length(btrim(_payload->>'reason')) not between 10 and 2000 or exists(select 1 from jsonb_object_keys(_payload) k where k<>all(case when _reverse then array['version','tenant_id','request_id','link_id','reason'] else array['version','tenant_id','request_id','expense_id','cost_id','revision','reason','same_expense_confirmed'] end)) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;reason:=btrim(_payload->>'reason');
 if t is null or request is null or (not _reverse and (_payload->'same_expense_confirmed' is distinct from 'true'::jsonb or coalesce(_payload->>'revision','') !~ '^[0-9a-f]{32}$')) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 action:=case when _reverse then 'reverse_legacy_expense_cost' else 'associate_legacy_expense_cost' end;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;
 if found then if prior.actor_id<>actor or prior.action<>action or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return prior.result;end if;
 if _reverse then
  select * into l from public.finance_legacy_expense_cost_links where tenant_id=t and id=(_payload->>'link_id')::uuid;
  if not found then raise exception 'finance_legacy_cost_link_not_found' using errcode='22023';end if;expense:=l.expense_id;cost:=l.cost_id;
  if exists(select 1 from public.finance_legacy_expense_cost_reversals where tenant_id=t and link_id=l.id) then raise exception 'finance_legacy_cost_already_reversed' using errcode='23514';end if;
 else expense:=(_payload->>'expense_id')::uuid;cost:=(_payload->>'cost_id')::uuid;end if;
 if expense is null or cost is null then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform 1 from public.payroll_periods where tenant_id=t order by id for update;
 select dispatch_trip_id into trip from public.driver_expenses where tenant_id=t and id=expense;
 perform 1 from public.dispatch_trips where tenant_id=t and id=trip for update;
 perform 1 from public.driver_settlements where tenant_id=t and dispatch_trip_id=trip order by id for update;
 perform 1 from public.payroll_entries where tenant_id=t order by payroll_period_id,id for update;
 perform 1 from public.driver_expenses where tenant_id=t and id=expense for update;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into actor_name from auth.users where id=actor;actor_name:=coalesce(actor_name,actor::text);
 if _reverse then
  issue:=finance_private.legacy_expense_protected_issue(t,expense);if issue is not null then raise exception '%',issue using errcode='23514';end if;
  insert into public.finance_legacy_expense_cost_reversals(tenant_id,link_id,actor_id,actor_name,reason) values(t,l.id,actor,actor_name,reason) returning id into reversal;
  result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'link_id',l.id,'expense_id',expense,'cost_id',cost,'amount_cents',l.amount_cents::text,'reversal_id',reversal,'cash_changed',false,'obligation_changed',false,'confirmed',true);
 else
  if finance_private.legacy_expense_cost_revision(t,expense,cost) is distinct from _payload->>'revision' then raise exception 'finance_legacy_cost_changed' using errcode='40001';end if;
  issue:=finance_private.legacy_expense_cost_issue(t,expense,cost);if issue is not null then raise exception '%',issue using errcode='23514';end if;
  snapshot:=finance_private.legacy_expense_cost_snapshot(t,expense,cost)||jsonb_build_object('version',1,'revision',_payload->>'revision','same_expense_confirmed',true);
  insert into public.finance_legacy_expense_cost_links(tenant_id,expense_id,cost_id,amount_cents,actor_id,actor_name,reason,source_snapshot)
   select t,expense,cost,c.amount_cents,actor,actor_name,reason,snapshot from public.finance_expense_items c where c.tenant_id=t and c.id=cost returning * into l;
  result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'link_id',l.id,'expense_id',expense,'cost_id',cost,'amount_cents',l.amount_cents::text,'cash_created',false,'obligation_created',false,'confirmed',true);
 end if;
 update public.driver_settlements set needs_recalculation=true,recalculation_reason=concat_ws('; ',nullif(recalculation_reason,''),'legacy_cost_association_changed') where tenant_id=t and dispatch_trip_id=trip;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(t,'legacy_expense_cost',expense,case when _reverse then 'legacy_expense_cost_association_reversed' else 'legacy_expense_cost_associated' end,actor,actor_name,reason,l.source_snapshot,result||jsonb_build_object('manual_intervention',true));
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,action,_payload,result);return result;
end$$;
revoke all on function finance_private.manage_legacy_expense_cost(jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function finance_private.manage_legacy_expense_cost(jsonb,boolean) to authenticated;
create function public.associate_finance_legacy_expense_cost(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.manage_legacy_expense_cost(_payload,false)$$;
create function public.reverse_finance_legacy_expense_cost_association(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.manage_legacy_expense_cost(_payload,true)$$;
revoke all on function public.associate_finance_legacy_expense_cost(jsonb),public.reverse_finance_legacy_expense_cost_association(jsonb) from public,anon,service_role;
grant execute on function public.associate_finance_legacy_expense_cost(jsonb),public.reverse_finance_legacy_expense_cost_association(jsonb) to authenticated;

-- Keep the legacy expense in the acerto, including its reimbursement identity;
-- remove only the second representation from canonical costs in that acerto.
do $$declare body text;needle text;begin
 select pg_get_functiondef('finance_private.canonical_trip_costs(uuid,uuid)'::regprocedure) into body;
 needle:='where e.tenant_id=_tenant and b.context=''trip'' and b.trip_id=_trip';
 if position(needle in body)=0 then raise exception 'finance_cost_settlement_contract_changed';end if;
 execute replace(body,needle,needle||' and not exists(select 1 from public.finance_legacy_expense_cost_links l where l.tenant_id=_tenant and l.cost_id=e.id and not exists(select 1 from public.finance_legacy_expense_cost_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id))');
end$$;
create function finance_private.preserve_associated_driver_expense() returns trigger language plpgsql security definer set search_path='' as $$begin
 if not pg_try_advisory_xact_lock(hashtextextended(old.tenant_id::text||':finance',0)) then raise exception 'finance_legacy_cost_concurrent_change' using errcode='40001';end if;
 if exists(select 1 from public.finance_legacy_expense_cost_links l where l.tenant_id=old.tenant_id and l.expense_id=old.id) then raise exception 'finance_legacy_cost_source_immutable' using errcode='55000';end if;
 return case when tg_op='DELETE' then old else new end;
end$$;
revoke all on function finance_private.preserve_associated_driver_expense() from public,anon,authenticated,service_role;
create trigger finance_preserve_associated_driver_expense before update or delete on public.driver_expenses for each row execute function finance_private.preserve_associated_driver_expense();
