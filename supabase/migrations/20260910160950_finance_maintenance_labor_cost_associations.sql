create table public.finance_maintenance_labor_links(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,order_id uuid not null,cost_id uuid not null,supplier_id uuid not null,
 amount_cents bigint not null check(amount_cents>0 and amount_cents<=99999999999999),actor_id uuid not null,actor_name text not null,
 reason text not null check(length(btrim(reason)) between 10 and 2000),source_snapshot jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(tenant_id,id)
);
create index finance_maintenance_labor_order on public.finance_maintenance_labor_links(tenant_id,order_id);
create index finance_maintenance_labor_target on public.finance_maintenance_labor_links(tenant_id,cost_id);
create table public.finance_maintenance_labor_reversals(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,link_id uuid not null,actor_id uuid not null,actor_name text not null,
 reason text not null check(length(btrim(reason)) between 10 and 2000),created_at timestamptz not null default clock_timestamp(),unique(tenant_id,link_id),
 foreign key(tenant_id,link_id) references public.finance_maintenance_labor_links(tenant_id,id)
);
do $$declare t text;begin foreach t in array array['finance_maintenance_labor_links','finance_maintenance_labor_reversals'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy finance_cost_source_read on public.%I for select to authenticated using(finance_private.can_access(tenant_id))',t);
 execute format('create trigger preserve_finance_cost_source before update or delete on public.%I for each row execute function finance_private.preserve_event()',t);
end loop;end$$;

create function finance_private.maintenance_labor_snapshot(_tenant uuid,_order uuid,_cost uuid) returns jsonb language sql stable set search_path='' as $$
select jsonb_build_object(
 'order',(select to_jsonb(m) from public.maintenance_orders m where m.tenant_id=_tenant and m.id=_order),
 'cost',(select to_jsonb(c) from public.finance_expense_items c where c.tenant_id=_tenant and c.id=_cost),
 'batch',(select to_jsonb(b) from public.finance_expense_batches b join public.finance_expense_items c on c.tenant_id=b.tenant_id and c.batch_id=b.id where c.tenant_id=_tenant and c.id=_cost),
 'supplier',(select to_jsonb(s) from public.clients s join public.finance_expense_items c on c.tenant_id=s.tenant_id and c.supplier_id=s.id where c.tenant_id=_tenant and c.id=_cost),
 'payables',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.payables p where p.tenant_id=_tenant and (p.id=(select c.payable_id from public.finance_expense_items c where c.tenant_id=_tenant and c.id=_cost) or (p.source_table='maintenance_orders' and p.source_id=_order))),
 'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.payables_payments p join public.payables title on title.tenant_id=p.tenant_id and title.id=p.payable_id where p.tenant_id=_tenant and (title.id=(select c.payable_id from public.finance_expense_items c where c.tenant_id=_tenant and c.id=_cost) or(title.source_table='maintenance_orders' and title.source_id=_order))),
 'allocations',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') from public.finance_expense_allocations a where a.tenant_id=_tenant and a.expense_id=_cost),
 'obligations',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from public.financial_obligations o where o.tenant_id=_tenant and o.source_table='maintenance_orders' and o.source_id=_order),
 'links',(select coalesce(jsonb_agg(jsonb_build_object('link',to_jsonb(l),'reversal',(select to_jsonb(r) from public.finance_maintenance_labor_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id)) order by l.id),'[]') from public.finance_maintenance_labor_links l where l.tenant_id=_tenant and (l.order_id=_order or l.cost_id=_cost))
)$$;
create function finance_private.maintenance_labor_revision(_tenant uuid,_order uuid,_cost uuid) returns text language sql stable set search_path='' as $$select md5(finance_private.maintenance_labor_snapshot(_tenant,_order,_cost)::text)$$;
create function finance_private.maintenance_labor_issue(_tenant uuid,_order uuid,_cost uuid) returns text language plpgsql stable set search_path='' as $$
declare m public.maintenance_orders%rowtype;c public.finance_expense_items%rowtype;b public.finance_expense_batches%rowtype;begin
 select * into m from public.maintenance_orders where tenant_id=_tenant and id=_order;
 if not found then return 'finance_maintenance_order_not_found';end if;
 if m.status is distinct from 'completed' then return 'finance_maintenance_labor_order_not_completed';end if;
 if m.labor_cost is null or not(m.labor_cost>0 and m.labor_cost*100=trunc(m.labor_cost*100) and m.labor_cost*100<=99999999999999) then return 'finance_maintenance_labor_invalid_value';end if;
 select * into c from public.finance_expense_items where tenant_id=_tenant and id=_cost;
 if not found then return 'finance_maintenance_labor_cost_not_found';end if;
 select * into b from public.finance_expense_batches where tenant_id=_tenant and id=c.batch_id;
 if not found or b.context is distinct from 'maintenance' or c.category not in('maintenance','service') then return 'finance_maintenance_labor_target_context';end if;
 if c.supplier_id is null or not exists(select 1 from public.clients s where s.tenant_id=_tenant and s.id=c.supplier_id) then return 'finance_maintenance_labor_supplier_required';end if;
 if c.amount_cents::numeric is distinct from m.labor_cost*100 or not isfinite(c.occurred_on) then return 'finance_maintenance_labor_source_mismatch';end if;
 if c.payable_id is not null and not exists(select 1 from public.payables p where p.tenant_id=_tenant and p.id=c.payable_id and p.status<>'cancelled' and p.amount*100=c.amount_cents and p.supplier_id=c.supplier_id) then return 'finance_maintenance_labor_target_obligation_invalid';end if;
 if exists(select 1 from public.finance_maintenance_labor_links l where l.tenant_id=_tenant and (l.order_id=_order or l.cost_id=_cost) and not exists(select 1 from public.finance_maintenance_labor_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id)) then return 'finance_maintenance_labor_already_associated';end if;
 if exists(select 1 from public.payables p where p.tenant_id=_tenant and p.id is distinct from c.payable_id and ((p.source_table='maintenance_orders' and p.source_id=_order) or(p.source_table='financial_obligations' and exists(select 1 from public.financial_obligations o where o.tenant_id=_tenant and o.id=p.source_id and o.source_table='maintenance_orders' and o.source_id=_order)))) then return 'finance_maintenance_labor_obligation_conflict';end if;
 return null;
end$$;
revoke all on function finance_private.maintenance_labor_snapshot(uuid,uuid,uuid),finance_private.maintenance_labor_revision(uuid,uuid,uuid),finance_private.maintenance_labor_issue(uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function finance_private.manage_maintenance_labor(_payload jsonb,_reverse boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;actor uuid:=auth.uid();actor_name text;os uuid;cost uuid;trip uuid;reason text;action text;issue text;result jsonb;prior public.finance_commands%rowtype;l public.finance_maintenance_labor_links%rowtype;reversal uuid;snapshot jsonb;
begin
 if jsonb_typeof(_payload) is distinct from 'object' or _payload->'version' is distinct from '1'::jsonb or jsonb_typeof(_payload->'reason') is distinct from 'string'
  or length(btrim(_payload->>'reason')) not between 10 and 2000 or exists(select 1 from jsonb_object_keys(_payload) k where k<>all(case when _reverse then array['version','tenant_id','request_id','link_id','reason'] else array['version','tenant_id','request_id','order_id','cost_id','revision','reason','same_labor_confirmed'] end)) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;reason:=btrim(_payload->>'reason');
 if t is null or request is null or (not _reverse and (_payload->'same_labor_confirmed' is distinct from 'true'::jsonb or coalesce(_payload->>'revision','') !~ '^[0-9a-f]{32}$')) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 action:=case when _reverse then 'reverse_maintenance_labor' else 'associate_maintenance_labor' end;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;
 if found then if prior.actor_id<>actor or prior.action<>action or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return prior.result;end if;
 if _reverse then
  select * into l from public.finance_maintenance_labor_links where tenant_id=t and id=(_payload->>'link_id')::uuid;
  if not found then raise exception 'finance_maintenance_labor_link_not_found' using errcode='22023';end if;os:=l.order_id;cost:=l.cost_id;
  if exists(select 1 from public.finance_maintenance_labor_reversals where tenant_id=t and link_id=l.id) then raise exception 'finance_maintenance_labor_already_reversed' using errcode='23514';end if;
 else os:=(_payload->>'order_id')::uuid;cost:=(_payload->>'cost_id')::uuid;end if;
 if os is null or cost is null then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform 1 from public.maintenance_orders where tenant_id=t and id=os for update;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into actor_name from auth.users where id=actor;actor_name:=coalesce(actor_name,actor::text);
 if _reverse then

  insert into public.finance_maintenance_labor_reversals(tenant_id,link_id,actor_id,actor_name,reason) values(t,l.id,actor,actor_name,reason) returning id into reversal;
  result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'link_id',l.id,'order_id',os,'cost_id',cost,'amount_cents',l.amount_cents::text,'reversal_id',reversal,'cash_changed',false,'obligation_changed',false,'confirmed',true);
 else
  if finance_private.maintenance_labor_revision(t,os,cost) is distinct from _payload->>'revision' then raise exception 'finance_maintenance_labor_changed' using errcode='40001';end if;
  issue:=finance_private.maintenance_labor_issue(t,os,cost);if issue is not null then raise exception '%',issue using errcode='23514';end if;
  snapshot:=finance_private.maintenance_labor_snapshot(t,os,cost)||jsonb_build_object('version',1,'revision',_payload->>'revision','same_labor_confirmed',true);
  insert into public.finance_maintenance_labor_links(tenant_id,order_id,cost_id,supplier_id,amount_cents,actor_id,actor_name,reason,source_snapshot)
   select t,os,cost,c.supplier_id,c.amount_cents,actor,actor_name,reason,snapshot from public.finance_expense_items c where c.tenant_id=t and c.id=cost returning * into l;
  result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'link_id',l.id,'order_id',os,'cost_id',cost,'amount_cents',l.amount_cents::text,'cash_created',false,'obligation_created',false,'confirmed',true);
 end if;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(t,'maintenance_labor',os,case when _reverse then 'maintenance_labor_association_reversed' else 'maintenance_labor_associated' end,actor,actor_name,reason,l.source_snapshot,result||jsonb_build_object('manual_intervention',true));
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,action,_payload,result);return result;
end$$;
revoke all on function finance_private.manage_maintenance_labor(jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function finance_private.manage_maintenance_labor(jsonb,boolean) to authenticated;
create function public.associate_finance_maintenance_labor(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.manage_maintenance_labor(_payload,false)$$;
create function public.reverse_finance_maintenance_labor_association(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.manage_maintenance_labor(_payload,true)$$;
revoke all on function public.associate_finance_maintenance_labor(jsonb),public.reverse_finance_maintenance_labor_association(jsonb) from public,anon,service_role;
grant execute on function public.associate_finance_maintenance_labor(jsonb),public.reverse_finance_maintenance_labor_association(jsonb) to authenticated;

-- Preserve financial identity while associated, without freezing operational notes.
-- After reversal, a corrected source can be reviewed again against its new revision.
create function finance_private.protect_maintenance_labor_source() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not pg_try_advisory_xact_lock(hashtextextended(old.tenant_id::text||':finance',0)) then raise exception 'finance_maintenance_labor_concurrent_change' using errcode='40001';end if;
 if exists(select 1 from public.finance_maintenance_labor_links l where l.tenant_id=old.tenant_id and l.order_id=old.id and not exists(select 1 from public.finance_maintenance_labor_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id)) then
  if tg_op='DELETE' then raise exception 'finance_maintenance_labor_source_protected' using errcode='55000';end if;
  if (new.id,new.tenant_id,new.labor_cost,new.supplier_vendor,new.vehicle_id,new.asset_id,new.status) is distinct from (old.id,old.tenant_id,old.labor_cost,old.supplier_vendor,old.vehicle_id,old.asset_id,old.status) then raise exception 'finance_maintenance_labor_source_protected' using errcode='55000';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end$$;
revoke all on function finance_private.protect_maintenance_labor_source() from public,anon,authenticated,service_role;
create trigger finance_maintenance_labor_source before update or delete on public.maintenance_orders for each row execute function finance_private.protect_maintenance_labor_source();
