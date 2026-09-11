create table public.finance_stock_acquisition_links(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,inbound_movement_id uuid not null,stock_item_id uuid not null,cost_id uuid not null,supplier_id uuid not null,
 quantity numeric not null check(quantity>0 and quantity::text not in('NaN','Infinity','-Infinity')),amount_cents bigint not null check(amount_cents between 1 and 99999999999999),
 actor_id uuid not null,actor_name text not null,reason text not null check(length(btrim(reason)) between 10 and 2000),source_snapshot jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(tenant_id,id)
);
create index finance_stock_acquisition_source on public.finance_stock_acquisition_links(tenant_id,inbound_movement_id);
create table public.finance_stock_acquisition_reversals(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,link_id uuid not null,actor_id uuid not null,actor_name text not null,reason text not null check(length(btrim(reason)) between 10 and 2000),created_at timestamptz not null default clock_timestamp(),unique(tenant_id,link_id),foreign key(tenant_id,link_id) references public.finance_stock_acquisition_links(tenant_id,id)
);
-- Explicit dependency registry. Subsequent consumption commands must reserve here atomically.
create table public.finance_stock_acquisition_dependencies(
 tenant_id uuid not null,acquisition_link_id uuid not null,source_kind text not null,source_id uuid not null,quantity numeric not null check(quantity>0 and quantity::text not in('NaN','Infinity','-Infinity')),
 amount_cents bigint not null check(amount_cents>0),primary key(tenant_id,source_kind,source_id,acquisition_link_id),foreign key(tenant_id,acquisition_link_id) references public.finance_stock_acquisition_links(tenant_id,id)
);
do $$declare t text;begin foreach t in array array['finance_stock_acquisition_links','finance_stock_acquisition_reversals','finance_stock_acquisition_dependencies'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 if t<>'finance_stock_acquisition_dependencies' then
 execute format('grant select on public.%I to authenticated',t);execute format('create policy finance_stock_source_read on public.%I for select to authenticated using(finance_private.can_access(tenant_id))',t);
 execute format('create trigger preserve_stock_source before update or delete on public.%I for each row execute function finance_private.preserve_event()',t);end if;
end loop;end$$;
alter table public.finance_maintenance_cost_claims drop constraint finance_maintenance_cost_claims_source_kind_check;
alter table public.finance_maintenance_cost_claims add constraint finance_maintenance_cost_claims_source_kind_check check(source_kind in('labor','direct_part','stock_acquisition'));
create function finance_private.stock_acquisition_dependencies(_tenant uuid,_link uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('ready',true,'blocking_count',count(*),'rows',coalesce(jsonb_agg(to_jsonb(d) order by d.source_kind,d.source_id),'[]')) from public.finance_stock_acquisition_dependencies d where tenant_id=_tenant and acquisition_link_id=_link
$$;
create function finance_private.stock_acquisition_snapshot(_tenant uuid,_inbound uuid,_cost uuid) returns jsonb language sql stable set search_path='' as $$
select finance_private.maintenance_labor_snapshot(_tenant,null,_cost)||jsonb_build_object(
 'inbound',(select to_jsonb(s) from public.stock_movements s where tenant_id=_tenant and id=_inbound),
 'catalog',(select to_jsonb(i) from public.stock_items i join public.stock_movements s on s.tenant_id=i.tenant_id and s.stock_item_id=i.id where s.tenant_id=_tenant and s.id=_inbound),
 'parts',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.maintenance_parts p where tenant_id=_tenant and stock_movement_id=_inbound),
 'source_payables',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.payables p where tenant_id=_tenant and (source_table='stock_movements' and source_id=_inbound or source_table='financial_obligations' and exists(select 1 from public.financial_obligations o where o.tenant_id=_tenant and o.id=p.source_id and o.source_table='stock_movements' and o.source_id=_inbound))),
 'source_obligations',(select coalesce(jsonb_agg(to_jsonb(o) order by id),'[]') from public.financial_obligations o where tenant_id=_tenant and source_table='stock_movements' and source_id=_inbound),
 'acquisition_links',(select coalesce(jsonb_agg(jsonb_build_object('link',to_jsonb(l),'reversal',(select to_jsonb(r) from public.finance_stock_acquisition_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id),'dependencies',finance_private.stock_acquisition_dependencies(_tenant,l.id)) order by l.id),'[]') from public.finance_stock_acquisition_links l where tenant_id=_tenant and (inbound_movement_id=_inbound or cost_id=_cost)),
 'claims',(select coalesce(jsonb_agg(to_jsonb(c) order by cost_id),'[]') from public.finance_maintenance_cost_claims c where tenant_id=_tenant and (cost_id=_cost or source_kind='stock_acquisition' and source_id=_inbound))
)
$$;
create function finance_private.stock_acquisition_revision(_tenant uuid,_inbound uuid,_cost uuid) returns text language sql stable set search_path='' as $$select md5(finance_private.stock_acquisition_snapshot(_tenant,_inbound,_cost)::text)$$;
create function finance_private.stock_acquisition_issue(_tenant uuid,_inbound uuid,_cost uuid) returns text language plpgsql stable set search_path='' as $$
declare s public.stock_movements%rowtype;c public.finance_expense_items%rowtype;begin
 select * into s from public.stock_movements where tenant_id=_tenant and id=_inbound;if not found then return 'finance_stock_acquisition_source_not_found';end if;
 if s.movement_type is distinct from 'inbound' or s.reason is distinct from 'purchase' then return 'finance_stock_acquisition_not_purchase';end if;
 if not exists(select 1 from public.stock_items where tenant_id=_tenant and id=s.stock_item_id) then return 'finance_stock_acquisition_catalog_invalid';end if;
 if not coalesce(isfinite(s.moved_at) and s.quantity>0 and s.quantity::text not in('NaN','Infinity','-Infinity') and s.unit_cost>0 and s.total_cost>0 and s.total_cost*100=trunc(s.total_cost*100) and s.total_cost*100<=99999999999999 and s.quantity*s.unit_cost=s.total_cost,false) then return 'finance_stock_acquisition_invalid_value';end if;
 if exists(select 1 from public.maintenance_parts where tenant_id=_tenant and stock_movement_id=_inbound) then return 'finance_stock_acquisition_part_conflict';end if;
 select * into c from public.finance_expense_items where tenant_id=_tenant and id=_cost;if not found then return 'finance_stock_acquisition_cost_not_found';end if;
 if c.category not in('maintenance','service','office','cleaning','fuel','other') or not exists(select 1 from public.finance_expense_batches where tenant_id=_tenant and id=c.batch_id and context in('maintenance','office','other')) then return 'finance_stock_acquisition_target_context';end if;
 if c.supplier_id is null or not exists(select 1 from public.clients where tenant_id=_tenant and id=c.supplier_id) then return 'finance_stock_acquisition_supplier_required';end if;
 if coalesce(length(btrim(c.document_number)),0) not between 1 and 200 then return 'finance_stock_acquisition_document_required';end if;
 if c.amount_cents::numeric is distinct from s.total_cost*100 or not isfinite(c.occurred_on) then return 'finance_stock_acquisition_source_mismatch';end if;
 if exists(select 1 from public.finance_maintenance_cost_claims where tenant_id=_tenant and (cost_id=_cost or source_kind='stock_acquisition' and source_id=_inbound)) then return 'finance_maintenance_cost_already_associated';end if;
 if c.payable_id is not null and not exists(select 1 from public.payables where tenant_id=_tenant and id=c.payable_id and status<>'cancelled' and amount*100=c.amount_cents and supplier_id=c.supplier_id) then return 'finance_stock_acquisition_obligation_invalid';end if;
 if exists(select 1 from public.payables p where tenant_id=_tenant and id is distinct from c.payable_id and (source_table='stock_movements' and source_id=_inbound or source_table='financial_obligations' and exists(select 1 from public.financial_obligations o where o.tenant_id=_tenant and o.id=p.source_id and o.source_table='stock_movements' and o.source_id=_inbound))) then return 'finance_stock_acquisition_obligation_conflict';end if;
 return null;
end$$;
create function finance_private.guard_stock_acquisition_link() returns trigger language plpgsql security definer set search_path='' as $$
declare l public.finance_stock_acquisition_links%rowtype;begin
 if not pg_try_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0)) then raise exception 'finance_stock_acquisition_concurrent_change' using errcode='40001';end if;
 if tg_table_name='finance_stock_acquisition_links' then
 insert into public.finance_maintenance_cost_claims values(new.tenant_id,new.cost_id,'stock_acquisition',new.inbound_movement_id,new.id);
 else
 select * into l from public.finance_stock_acquisition_links where tenant_id=new.tenant_id and id=new.link_id;
 if exists(select 1 from public.finance_stock_acquisition_dependencies where tenant_id=new.tenant_id and acquisition_link_id=new.link_id) then raise exception 'finance_stock_acquisition_has_dependents' using errcode='55000';end if;
 delete from public.finance_maintenance_cost_claims where tenant_id=new.tenant_id and source_kind='stock_acquisition' and link_id=new.link_id;
 end if;return new;
end$$;
create trigger finance_claim_stock_acquisition after insert on public.finance_stock_acquisition_links for each row execute function finance_private.guard_stock_acquisition_link();
create trigger finance_release_stock_acquisition before insert on public.finance_stock_acquisition_reversals for each row execute function finance_private.guard_stock_acquisition_link();
create function finance_private.guard_stock_acquisition_dependency() returns trigger language plpgsql security definer set search_path='' as $$
declare l public.finance_stock_acquisition_links%rowtype;t uuid;begin
 if tg_op<>'INSERT' then raise exception 'finance_stock_dependency_correction_required' using errcode='55000';end if;t:=new.tenant_id;
 if not pg_try_advisory_xact_lock(hashtextextended(t::text||':finance',0)) then raise exception 'finance_stock_acquisition_concurrent_change' using errcode='40001';end if;
 select * into l from public.finance_stock_acquisition_links where tenant_id=t and id=new.acquisition_link_id;
 if not found or exists(select 1 from public.finance_stock_acquisition_reversals where tenant_id=t and link_id=l.id) then raise exception 'finance_stock_acquisition_inactive' using errcode='55000';end if;
 if new.quantity+(select coalesce(sum(quantity),0) from public.finance_stock_acquisition_dependencies where tenant_id=t and acquisition_link_id=l.id)>l.quantity or new.amount_cents+(select coalesce(sum(amount_cents),0) from public.finance_stock_acquisition_dependencies where tenant_id=t and acquisition_link_id=l.id)>l.amount_cents then raise exception 'finance_stock_acquisition_capacity_exceeded' using errcode='23514';end if;return new;
end$$;
create trigger finance_stock_dependency before insert or update or delete on public.finance_stock_acquisition_dependencies for each row execute function finance_private.guard_stock_acquisition_dependency();
create function finance_private.manage_stock_acquisition(_payload jsonb,_reverse boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;actor uuid:=auth.uid();actor_name text;inbound uuid;cost uuid;item uuid;issue text;action text;result jsonb;prior public.finance_commands%rowtype;l public.finance_stock_acquisition_links%rowtype;reversal uuid;snapshot jsonb;
begin
 if jsonb_typeof(_payload) is distinct from 'object' or _payload->'version' is distinct from '1'::jsonb or jsonb_typeof(_payload->'reason') is distinct from 'string' or length(btrim(_payload->>'reason')) not between 10 and 2000 or coalesce(_payload->>'revision','') !~ '^[0-9a-f]{32}$'
 or exists(select 1 from jsonb_object_keys(_payload) k where k<>all(case when _reverse then array['version','tenant_id','request_id','link_id','revision','reason'] else array['version','tenant_id','request_id','inbound_movement_id','cost_id','revision','reason','quantity','document_number','same_purchase_confirmed'] end)) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;
 if t is null or request is null or (not _reverse and (_payload->'same_purchase_confirmed' is distinct from 'true'::jsonb or jsonb_typeof(_payload->'quantity') is distinct from 'string' or coalesce(_payload->>'quantity','') !~ '^[0-9]+(\.[0-9]+)?$' or jsonb_typeof(_payload->'document_number') is distinct from 'string')) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 action:=case when _reverse then 'reverse_stock_acquisition_association' else 'associate_stock_acquisition' end;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;if found then if prior.actor_id<>actor or prior.action<>action or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return prior.result;end if;
 if _reverse then
 select * into l from public.finance_stock_acquisition_links where tenant_id=t and id=(_payload->>'link_id')::uuid;if not found then raise exception 'finance_stock_acquisition_link_not_found' using errcode='22023';end if;
 inbound:=l.inbound_movement_id;cost:=l.cost_id;
 if exists(select 1 from public.finance_stock_acquisition_reversals where tenant_id=t and link_id=l.id) then raise exception 'finance_stock_acquisition_already_reversed' using errcode='23514';end if;
 else inbound:=(_payload->>'inbound_movement_id')::uuid;cost:=(_payload->>'cost_id')::uuid;end if;
 if inbound is null or cost is null then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 select stock_item_id into item from public.stock_movements where tenant_id=t and id=inbound;
 perform 1 from public.stock_items where tenant_id=t and id=item for update;
 perform 1 from public.stock_movements where tenant_id=t and id=inbound for update;
 perform 1 from public.finance_expense_items where tenant_id=t and id=cost for update;
 perform 1 from public.clients where tenant_id=t and id=(select supplier_id from public.finance_expense_items where tenant_id=t and id=cost) for update;
 perform 1 from public.payables p where tenant_id=t and (id=(select payable_id from public.finance_expense_items where tenant_id=t and id=cost) or source_table='stock_movements' and source_id=inbound) order by id for update;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if finance_private.stock_acquisition_revision(t,inbound,cost) is distinct from _payload->>'revision' then raise exception 'finance_stock_acquisition_changed' using errcode='40001';end if;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into actor_name from auth.users where id=actor;actor_name:=coalesce(actor_name,actor::text);
 if _reverse then
 insert into public.finance_stock_acquisition_reversals(tenant_id,link_id,actor_id,actor_name,reason) values(t,l.id,actor,actor_name,btrim(_payload->>'reason')) returning id into reversal;
 else
 issue:=finance_private.stock_acquisition_issue(t,inbound,cost);if issue is not null then raise exception '%',issue using errcode='23514';end if;
 if (_payload->>'quantity')::numeric is distinct from (select quantity from public.stock_movements where tenant_id=t and id=inbound) or _payload->>'document_number' is distinct from (select document_number from public.finance_expense_items where tenant_id=t and id=cost) then raise exception 'finance_stock_acquisition_declaration_mismatch' using errcode='23514';end if;
 snapshot:=finance_private.stock_acquisition_snapshot(t,inbound,cost)||jsonb_build_object('revision',_payload->>'revision','same_purchase_confirmed',true,'quantity',_payload->>'quantity','document_number',_payload->>'document_number');
 insert into public.finance_stock_acquisition_links(tenant_id,inbound_movement_id,stock_item_id,cost_id,supplier_id,quantity,amount_cents,actor_id,actor_name,reason,source_snapshot)
 select t,inbound,item,cost,c.supplier_id,s.quantity,c.amount_cents,actor,actor_name,btrim(_payload->>'reason'),snapshot from public.finance_expense_items c join public.stock_movements s on s.tenant_id=c.tenant_id and s.id=inbound where c.tenant_id=t and c.id=cost returning * into l;
 end if;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'link_id',l.id,'inbound_movement_id',l.inbound_movement_id,'stock_item_id',l.stock_item_id,'cost_id',l.cost_id,'quantity',trim_scale(l.quantity)::text,'amount_cents',l.amount_cents::text,'confirmed',true,'cash_changed',false,'obligation_created',false,'cost_created',false);
 if _reverse then result:=result||jsonb_build_object('reversal_id',reversal);end if;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(t,'stock_acquisition',inbound,case when _reverse then 'stock_acquisition_association_reversed' else 'stock_acquisition_associated' end,actor,actor_name,btrim(_payload->>'reason'),l.source_snapshot,result||jsonb_build_object('manual_intervention',true));
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,action,_payload,result);return result;
end$$;
create function finance_private.protect_stock_acquisition_source() returns trigger language plpgsql security definer set search_path='' as $$
declare d jsonb;t uuid;tenants uuid[];begin
 select array_agg(distinct x order by x) into tenants from unnest(array[case when tg_op<>'INSERT' then old.tenant_id end,case when tg_op<>'DELETE' then new.tenant_id end]) x where x is not null;
 foreach t in array tenants loop if not pg_try_advisory_xact_lock(hashtextextended(t::text||':finance',0)) then raise exception 'finance_stock_acquisition_concurrent_change' using errcode='40001';end if;end loop;
 if tg_table_name='maintenance_parts' then
 for d in select v from (values(case when tg_op<>'INSERT' then to_jsonb(old) end),(case when tg_op<>'DELETE' then to_jsonb(new) end)) q(v) where v is not null loop
 if exists(select 1 from public.finance_stock_acquisition_links l join public.finance_maintenance_cost_claims c on c.tenant_id=l.tenant_id and c.link_id=l.id and c.source_kind='stock_acquisition' where l.tenant_id=(d->>'tenant_id')::uuid and l.inbound_movement_id=(d->>'stock_movement_id')::uuid) then raise exception 'finance_stock_acquisition_part_conflict' using errcode='55000';end if;end loop;
 elsif tg_op<>'INSERT' then
 if exists(select 1 from public.finance_stock_acquisition_links l join public.finance_maintenance_cost_claims c on c.tenant_id=l.tenant_id and c.link_id=l.id and c.source_kind='stock_acquisition' where l.tenant_id=old.tenant_id and (tg_table_name='stock_movements' and l.inbound_movement_id=old.id or tg_table_name='stock_items' and l.stock_item_id=old.id)) then
 if tg_op='DELETE' then raise exception 'finance_stock_acquisition_source_protected' using errcode='55000';end if;
 if tg_table_name='stock_items' then
 if (new.id,new.tenant_id,new.unit) is distinct from(old.id,old.tenant_id,old.unit) then raise exception 'finance_stock_acquisition_source_protected' using errcode='55000';end if;
 elsif to_jsonb(new)-'justification' is distinct from to_jsonb(old)-'justification' then raise exception 'finance_stock_acquisition_source_protected' using errcode='55000';end if;
 end if;end if;
 if tg_op='DELETE' then return old;end if;return new;
end$$;
create trigger finance_stock_acquisition_source before update or delete on public.stock_movements for each row execute function finance_private.protect_stock_acquisition_source();
create trigger finance_stock_acquisition_catalog before update or delete on public.stock_items for each row execute function finance_private.protect_stock_acquisition_source();
create trigger finance_stock_acquisition_part before insert or update or delete on public.maintenance_parts for each row execute function finance_private.protect_stock_acquisition_source();
revoke all on function finance_private.stock_acquisition_dependencies(uuid,uuid),finance_private.stock_acquisition_snapshot(uuid,uuid,uuid),finance_private.stock_acquisition_revision(uuid,uuid,uuid),finance_private.stock_acquisition_issue(uuid,uuid,uuid),finance_private.guard_stock_acquisition_link(),finance_private.guard_stock_acquisition_dependency(),finance_private.protect_stock_acquisition_source(),finance_private.manage_stock_acquisition(jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function finance_private.manage_stock_acquisition(jsonb,boolean) to authenticated;
create function public.associate_finance_stock_acquisition(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.manage_stock_acquisition(_payload,false)$$;
create function public.reverse_finance_stock_acquisition_association(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.manage_stock_acquisition(_payload,true)$$;
revoke all on function public.associate_finance_stock_acquisition(jsonb),public.reverse_finance_stock_acquisition_association(jsonb) from public,anon,service_role;
grant execute on function public.associate_finance_stock_acquisition(jsonb),public.reverse_finance_stock_acquisition_association(jsonb) to authenticated;
