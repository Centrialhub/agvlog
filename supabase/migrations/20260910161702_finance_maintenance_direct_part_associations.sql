create table public.finance_maintenance_direct_part_links(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,order_id uuid not null,part_id uuid not null,cost_id uuid not null,supplier_id uuid not null,
 amount_cents bigint not null check(amount_cents>0 and amount_cents<=99999999999999),actor_id uuid not null,actor_name text not null,
 reason text not null check(length(btrim(reason)) between 10 and 2000),source_snapshot jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(tenant_id,id)
);
create index finance_maintenance_direct_part_order on public.finance_maintenance_direct_part_links(tenant_id,order_id);
create index finance_maintenance_direct_part_target on public.finance_maintenance_direct_part_links(tenant_id,cost_id);
create table public.finance_maintenance_direct_part_reversals(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,link_id uuid not null,actor_id uuid not null,actor_name text not null,
 reason text not null check(length(btrim(reason)) between 10 and 2000),created_at timestamptz not null default clock_timestamp(),unique(tenant_id,link_id),
 foreign key(tenant_id,link_id) references public.finance_maintenance_direct_part_links(tenant_id,id)
);
do $$declare t text;begin foreach t in array array['finance_maintenance_direct_part_links','finance_maintenance_direct_part_reversals'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy finance_cost_source_read on public.%I for select to authenticated using(finance_private.can_access(tenant_id))',t);
 execute format('create trigger preserve_finance_cost_source before update or delete on public.%I for each row execute function finance_private.preserve_event()',t);
end loop;end$$;

create table public.finance_maintenance_cost_claims(
 tenant_id uuid not null,cost_id uuid not null,source_kind text not null check(source_kind in('labor','direct_part')),source_id uuid not null,link_id uuid not null,
 primary key(tenant_id,cost_id),unique(tenant_id,source_kind,source_id)
);
alter table public.finance_maintenance_cost_claims enable row level security;
revoke all on public.finance_maintenance_cost_claims from public,anon,authenticated,service_role;
-- Fail the migration on pre-existing duplicate active sources/targets.
insert into public.finance_maintenance_cost_claims select l.tenant_id,l.cost_id,'labor',l.order_id,l.id from public.finance_maintenance_labor_links l where not exists(select 1 from public.finance_maintenance_labor_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id);
create function finance_private.claim_maintenance_cost() returns trigger language plpgsql security definer set search_path='' as $$
declare kind text;src uuid;cost uuid;begin
 if not pg_try_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0)) then raise exception 'finance_maintenance_cost_concurrent_change' using errcode='40001';end if;
 kind:=case when tg_table_name like '%direct_part%' then 'direct_part' else 'labor' end;
 if tg_table_name like '%_links' then
  if kind='labor' then src:=new.order_id;else src:=new.part_id;end if;
  insert into public.finance_maintenance_cost_claims values(new.tenant_id,new.cost_id,kind,src,new.id);
 else
  delete from public.finance_maintenance_cost_claims where tenant_id=new.tenant_id and source_kind=kind and link_id=new.link_id;
 end if;
 return new;
end$$;
revoke all on function finance_private.claim_maintenance_cost() from public,anon,authenticated,service_role;
create trigger finance_claim_labor_cost after insert on public.finance_maintenance_labor_links for each row execute function finance_private.claim_maintenance_cost();
create trigger finance_release_labor_cost after insert on public.finance_maintenance_labor_reversals for each row execute function finance_private.claim_maintenance_cost();
create trigger finance_claim_direct_part_cost after insert on public.finance_maintenance_direct_part_links for each row execute function finance_private.claim_maintenance_cost();
create trigger finance_release_direct_part_cost after insert on public.finance_maintenance_direct_part_reversals for each row execute function finance_private.claim_maintenance_cost();
do $$declare body text;begin
 select pg_get_functiondef('finance_private.maintenance_labor_issue(uuid,uuid,uuid)'::regprocedure) into body;
 if position(' return null;' in body)=0 then raise exception 'finance_maintenance_labor_contract_changed';end if;
 execute replace(body,' return null;', ' if exists(select 1 from public.finance_maintenance_cost_claims where tenant_id=_tenant and cost_id=_cost) then return ''finance_maintenance_cost_already_associated'';end if; return null;');
end$$;
do $$declare body text;begin
 select pg_get_functiondef('finance_private.maintenance_labor_snapshot(uuid,uuid,uuid)'::regprocedure) into body;
 if position('select jsonb_build_object(' in body)=0 then raise exception 'finance_maintenance_snapshot_contract_changed';end if;
 execute replace(body,'select jsonb_build_object(', 'select jsonb_build_object(''shared_claims'',(select coalesce(jsonb_agg(to_jsonb(c) order by c.cost_id),''[]'') from public.finance_maintenance_cost_claims c where c.tenant_id=_tenant and c.cost_id=_cost),');
end$$;
create function finance_private.maintenance_direct_part_snapshot(_tenant uuid,_part uuid,_cost uuid) returns jsonb language sql stable set search_path='' as $$
select finance_private.maintenance_labor_snapshot(_tenant,p.maintenance_order_id,_cost)||jsonb_build_object(
 'part',to_jsonb(p),'catalog',(select to_jsonb(i) from public.stock_items i where i.tenant_id=_tenant and i.id=p.stock_item_id),
 'part_payables',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from public.payables t where t.tenant_id=_tenant and (t.source_table='maintenance_parts' and t.source_id=_part or t.source_table='financial_obligations' and exists(select 1 from public.financial_obligations o where o.tenant_id=_tenant and o.id=t.source_id and o.source_table='maintenance_parts' and o.source_id=_part))),
 'part_obligations',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from public.financial_obligations o where o.tenant_id=_tenant and o.source_table='maintenance_parts' and o.source_id=_part),
 'stock',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.stock_movements s where s.tenant_id=_tenant and (s.id=p.stock_movement_id or(s.maintenance_order_id=p.maintenance_order_id and s.stock_item_id=p.stock_item_id))),
 'claims',(select coalesce(jsonb_agg(to_jsonb(c) order by c.cost_id),'[]') from public.finance_maintenance_cost_claims c where c.tenant_id=_tenant and (c.cost_id=_cost or(c.source_kind='direct_part' and c.source_id=_part))),
 'part_links',(select coalesce(jsonb_agg(jsonb_build_object('link',to_jsonb(l),'reversal',(select to_jsonb(r) from public.finance_maintenance_direct_part_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id)) order by l.id),'[]') from public.finance_maintenance_direct_part_links l where l.tenant_id=_tenant and (l.part_id=_part or l.cost_id=_cost))
) from public.maintenance_parts p where p.tenant_id=_tenant and p.id=_part
$$;
create function finance_private.maintenance_direct_part_revision(_tenant uuid,_part uuid,_cost uuid) returns text language sql stable set search_path='' as $$select md5(coalesce(finance_private.maintenance_direct_part_snapshot(_tenant,_part,_cost),'null'::jsonb)::text)$$;
create function finance_private.maintenance_direct_part_issue(_tenant uuid,_part uuid,_cost uuid) returns text language plpgsql stable set search_path='' as $$
declare p public.maintenance_parts%rowtype;c public.finance_expense_items%rowtype;begin
 select * into p from public.maintenance_parts where tenant_id=_tenant and id=_part;
 if not found then return 'finance_maintenance_part_not_found';end if;
 if not exists(select 1 from public.maintenance_orders m where m.tenant_id=_tenant and m.id=p.maintenance_order_id and m.status='completed') then return 'finance_maintenance_direct_part_order_not_completed';end if;
 if p.stock_movement_id is not null then return 'finance_maintenance_part_stock_consumption';end if;
 if p.stock_item_id is not null and not exists(select 1 from public.stock_items i where i.tenant_id=_tenant and i.id=p.stock_item_id) then return 'finance_maintenance_part_catalog_invalid';end if;
 if exists(select 1 from public.stock_movements s where s.tenant_id=_tenant and s.maintenance_order_id=p.maintenance_order_id and s.stock_item_id=p.stock_item_id) then return 'finance_maintenance_part_stock_requires_review';end if;
 if not coalesce(p.quantity>0 and p.quantity::text not in('NaN','Infinity','-Infinity') and p.unit_cost>0 and p.total_cost>0 and p.total_cost*100=trunc(p.total_cost*100) and p.total_cost*100<=99999999999999 and p.unit_cost*p.quantity=p.total_cost,false) then return 'finance_maintenance_direct_part_invalid_value';end if;
 select * into c from public.finance_expense_items where tenant_id=_tenant and id=_cost;
 if not found then return 'finance_maintenance_direct_part_cost_not_found';end if;
 if c.category not in('maintenance','service') or not exists(select 1 from public.finance_expense_batches b where b.tenant_id=_tenant and b.id=c.batch_id and b.context='maintenance') then return 'finance_maintenance_direct_part_target_context';end if;
 if c.supplier_id is null or not exists(select 1 from public.clients s where s.tenant_id=_tenant and s.id=c.supplier_id) then return 'finance_maintenance_direct_part_supplier_required';end if;
 if coalesce(length(btrim(c.document_number)),0)=0 then return 'finance_maintenance_direct_part_document_required';end if;
 if c.amount_cents::numeric is distinct from p.total_cost*100 or not isfinite(c.occurred_on) then return 'finance_maintenance_direct_part_source_mismatch';end if;
 if exists(select 1 from public.finance_maintenance_cost_claims where tenant_id=_tenant and (cost_id=_cost or(source_kind='direct_part' and source_id=_part))) then return 'finance_maintenance_cost_already_associated';end if;
 if c.payable_id is not null and not exists(select 1 from public.payables t where t.tenant_id=_tenant and t.id=c.payable_id and t.status<>'cancelled' and t.amount*100=c.amount_cents and t.supplier_id=c.supplier_id) then return 'finance_maintenance_direct_part_target_obligation_invalid';end if;
 if exists(select 1 from public.payables t where t.tenant_id=_tenant and t.id is distinct from c.payable_id and ((t.source_table='maintenance_parts' and t.source_id=_part) or(t.source_table='maintenance_orders' and t.source_id=p.maintenance_order_id) or(t.source_table='financial_obligations' and exists(select 1 from public.financial_obligations o where o.tenant_id=_tenant and o.id=t.source_id and ((o.source_table='maintenance_parts' and o.source_id=_part) or(o.source_table='maintenance_orders' and o.source_id=p.maintenance_order_id)))))) then return 'finance_maintenance_direct_part_obligation_conflict';end if;
 return null;
end$$;
revoke all on function finance_private.maintenance_direct_part_snapshot(uuid,uuid,uuid),finance_private.maintenance_direct_part_revision(uuid,uuid,uuid),finance_private.maintenance_direct_part_issue(uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function finance_private.manage_maintenance_direct_part(_payload jsonb,_reverse boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;actor uuid:=auth.uid();actor_name text;os uuid;part uuid;cost uuid;reason text;action text;issue text;result jsonb;prior public.finance_commands%rowtype;l public.finance_maintenance_direct_part_links%rowtype;reversal uuid;snapshot jsonb;
begin
 if jsonb_typeof(_payload) is distinct from 'object' or _payload->'version' is distinct from '1'::jsonb or jsonb_typeof(_payload->'reason') is distinct from 'string'
  or length(btrim(_payload->>'reason')) not between 10 and 2000 or exists(select 1 from jsonb_object_keys(_payload) k where k<>all(case when _reverse then array['version','tenant_id','request_id','link_id','reason'] else array['version','tenant_id','request_id','part_id','cost_id','revision','reason','classification','quantity','document_number','same_part_confirmed'] end)) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;reason:=btrim(_payload->>'reason');
 if t is null or request is null or (not _reverse and (_payload->'same_part_confirmed' is distinct from 'true'::jsonb or coalesce(_payload->>'revision','') !~ '^[0-9a-f]{32}$')) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if not _reverse and (_payload->>'classification' is distinct from 'direct_purchase' or jsonb_typeof(_payload->'quantity') is distinct from 'string' or coalesce(_payload->>'quantity','') !~ '^[0-9]+(\.[0-9]+)?$' or jsonb_typeof(_payload->'document_number') is distinct from 'string' or length(btrim(_payload->>'document_number')) not between 1 and 200) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 action:=case when _reverse then 'reverse_maintenance_direct_part' else 'associate_maintenance_direct_part' end;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;
 if found then if prior.actor_id<>actor or prior.action<>action or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return prior.result;end if;
 if _reverse then
  select * into l from public.finance_maintenance_direct_part_links where tenant_id=t and id=(_payload->>'link_id')::uuid;
  if not found then raise exception 'finance_maintenance_direct_part_link_not_found' using errcode='22023';end if;os:=l.order_id;part:=l.part_id;cost:=l.cost_id;
  if exists(select 1 from public.finance_maintenance_direct_part_reversals where tenant_id=t and link_id=l.id) then raise exception 'finance_maintenance_direct_part_already_reversed' using errcode='23514';end if;
 else part:=(_payload->>'part_id')::uuid;cost:=(_payload->>'cost_id')::uuid;select maintenance_order_id into os from public.maintenance_parts where tenant_id=t and id=part;end if;
 if part is null or cost is null then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform 1 from public.maintenance_orders where tenant_id=t and id=os for update;
 perform 1 from public.maintenance_parts where tenant_id=t and id=part for update;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into actor_name from auth.users where id=actor;actor_name:=coalesce(actor_name,actor::text);
 if _reverse then

  insert into public.finance_maintenance_direct_part_reversals(tenant_id,link_id,actor_id,actor_name,reason) values(t,l.id,actor,actor_name,reason) returning id into reversal;
  result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'link_id',l.id,'order_id',os,'part_id',part,'cost_id',cost,'amount_cents',l.amount_cents::text,'reversal_id',reversal,'cash_changed',false,'obligation_changed',false,'confirmed',true);
 else
  if finance_private.maintenance_direct_part_revision(t,part,cost) is distinct from _payload->>'revision' then raise exception 'finance_maintenance_direct_part_changed' using errcode='40001';end if;
  issue:=finance_private.maintenance_direct_part_issue(t,part,cost);if issue is not null then raise exception '%',issue using errcode='23514';end if;
  if (_payload->>'quantity')::numeric is distinct from (select quantity from public.maintenance_parts where tenant_id=t and id=part) or _payload->>'document_number' is distinct from (select document_number from public.finance_expense_items where tenant_id=t and id=cost) then raise exception 'finance_maintenance_direct_part_declaration_mismatch' using errcode='23514';end if;
  snapshot:=finance_private.maintenance_direct_part_snapshot(t,part,cost)||jsonb_build_object('version',1,'revision',_payload->>'revision','same_part_confirmed',true,'classification','direct_purchase','quantity',_payload->>'quantity','document_number',_payload->>'document_number');
  insert into public.finance_maintenance_direct_part_links(tenant_id,order_id,part_id,cost_id,supplier_id,amount_cents,actor_id,actor_name,reason,source_snapshot)
   select t,os,part,cost,c.supplier_id,c.amount_cents,actor,actor_name,reason,snapshot from public.finance_expense_items c where c.tenant_id=t and c.id=cost returning * into l;
  result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'link_id',l.id,'order_id',os,'part_id',part,'cost_id',cost,'amount_cents',l.amount_cents::text,'cash_created',false,'obligation_created',false,'confirmed',true);
 end if;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(t,'maintenance_direct_part',os,case when _reverse then 'maintenance_direct_part_association_reversed' else 'maintenance_direct_part_associated' end,actor,actor_name,reason,l.source_snapshot,result||jsonb_build_object('manual_intervention',true));
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,action,_payload,result);return result;
end$$;
revoke all on function finance_private.manage_maintenance_direct_part(jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function finance_private.manage_maintenance_direct_part(jsonb,boolean) to authenticated;
create function public.associate_finance_maintenance_direct_part(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.manage_maintenance_direct_part(_payload,false)$$;
create function public.reverse_finance_maintenance_direct_part_association(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.manage_maintenance_direct_part(_payload,true)$$;
revoke all on function public.associate_finance_maintenance_direct_part(jsonb),public.reverse_finance_maintenance_direct_part_association(jsonb) from public,anon,service_role;
grant execute on function public.associate_finance_maintenance_direct_part(jsonb),public.reverse_finance_maintenance_direct_part_association(jsonb) to authenticated;

create function finance_private.protect_direct_part_source() returns trigger language plpgsql security definer set search_path='' as $$begin
 if not pg_try_advisory_xact_lock(hashtextextended(old.tenant_id::text||':finance',0)) then raise exception 'finance_maintenance_cost_concurrent_change' using errcode='40001';end if;
 if exists(select 1 from public.finance_maintenance_cost_claims where tenant_id=old.tenant_id and source_kind='direct_part' and source_id=old.id) then
  if tg_op='DELETE' then raise exception 'finance_maintenance_direct_part_source_protected' using errcode='55000';end if;
  if to_jsonb(new)-'notes' is distinct from to_jsonb(old)-'notes' then raise exception 'finance_maintenance_direct_part_source_protected' using errcode='55000';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end$$;
revoke all on function finance_private.protect_direct_part_source() from public,anon,authenticated,service_role;
create trigger finance_direct_part_source before update or delete on public.maintenance_parts for each row execute function finance_private.protect_direct_part_source();
create function finance_private.protect_direct_part_context() returns trigger language plpgsql security definer set search_path='' as $$
declare data jsonb;t uuid;begin
 data:=case when tg_op='DELETE' or tg_table_name='maintenance_orders' then to_jsonb(old) else to_jsonb(new) end;t:=(data->>'tenant_id')::uuid;
 if not pg_try_advisory_xact_lock(hashtextextended(t::text||':finance',0)) then raise exception 'finance_maintenance_cost_concurrent_change' using errcode='40001';end if;
 if tg_table_name='maintenance_orders' then
  if exists(select 1 from public.finance_maintenance_direct_part_links l join public.finance_maintenance_cost_claims c on c.tenant_id=l.tenant_id and c.link_id=l.id and c.source_kind='direct_part' where l.tenant_id=t and l.order_id=old.id) then
   if tg_op='DELETE' then raise exception 'finance_maintenance_direct_part_source_protected' using errcode='55000';end if;
   if (new.id,new.tenant_id,new.status,new.vehicle_id,new.asset_id) is distinct from (old.id,old.tenant_id,old.status,old.vehicle_id,old.asset_id) then raise exception 'finance_maintenance_direct_part_source_protected' using errcode='55000';end if;
  end if;
 else
  if exists(select 1 from public.maintenance_parts p join public.finance_maintenance_cost_claims c on c.tenant_id=p.tenant_id and c.source_kind='direct_part' and c.source_id=p.id where p.tenant_id=t and p.maintenance_order_id=(data->>'maintenance_order_id')::uuid and p.stock_item_id=(data->>'stock_item_id')::uuid) then raise exception 'finance_maintenance_part_stock_requires_review' using errcode='55000';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end$$;
revoke all on function finance_private.protect_direct_part_context() from public,anon,authenticated,service_role;
create trigger finance_direct_part_order before update or delete on public.maintenance_orders for each row execute function finance_private.protect_direct_part_context();
create trigger finance_direct_part_stock before insert or update on public.stock_movements for each row execute function finance_private.protect_direct_part_context();
