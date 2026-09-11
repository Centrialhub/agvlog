-- Invoice total is authoritative within the reviewed purchase. Unit price may carry
-- sub-cent precision; verify its rounded extended total rather than exact division.
do $$declare body text;begin
 select pg_get_functiondef('finance_private.stock_acquisition_issue(uuid,uuid,uuid)'::regprocedure) into body;
 if position('s.quantity*s.unit_cost=s.total_cost' in body)=0 then raise exception 'finance_stock_acquisition_rounding_contract_changed';end if;
 execute replace(body,'s.quantity*s.unit_cost=s.total_cost','round(s.quantity*s.unit_cost*100)=s.total_cost*100');
 select pg_get_functiondef('finance_private.stock_acquisition_snapshot(uuid,uuid,uuid)'::regprocedure) into body;
 execute replace(body,'''inbound'',','''unit_price_validation'',''rounded_extended_total_cents_v1'',''inbound'',');
end$$;
create table public.finance_stock_consumption_attributions(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,part_id uuid not null,consumption_movement_id uuid not null,order_id uuid not null,
 policy text not null check(policy='remaining_balance_floor_v1'),revision text not null,source_snapshot jsonb not null,actor_id uuid not null,actor_name text not null,reason text not null check(length(btrim(reason)) between 10 and 2000),created_at timestamptz not null default clock_timestamp(),unique(tenant_id,id)
);
create table public.finance_stock_consumption_lines(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,attribution_id uuid not null,acquisition_link_id uuid not null,quantity numeric not null check(quantity>0 and quantity::text not in('NaN','Infinity','-Infinity')),amount_cents bigint not null check(amount_cents>=0),balance_snapshot jsonb not null,
 unique(tenant_id,id),unique(tenant_id,attribution_id,acquisition_link_id),foreign key(tenant_id,attribution_id) references public.finance_stock_consumption_attributions(tenant_id,id),foreign key(tenant_id,acquisition_link_id) references public.finance_stock_acquisition_links(tenant_id,id)
);
create table public.finance_stock_consumption_reversals(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,attribution_id uuid not null,actor_id uuid not null,actor_name text not null,reason text not null check(length(btrim(reason)) between 10 and 2000),created_at timestamptz not null default clock_timestamp(),unique(tenant_id,attribution_id),foreign key(tenant_id,attribution_id) references public.finance_stock_consumption_attributions(tenant_id,id)
);
create table finance_private.stock_consumption_claims(tenant_id uuid not null,part_id uuid not null,consumption_movement_id uuid not null,attribution_id uuid not null,primary key(tenant_id,part_id),unique(tenant_id,consumption_movement_id));
revoke all on finance_private.stock_consumption_claims from public,anon,authenticated,service_role;
do $$declare t text;begin foreach t in array array['finance_stock_consumption_attributions','finance_stock_consumption_lines','finance_stock_consumption_reversals'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);execute format('grant select on public.%I to authenticated',t);
 execute format('create policy finance_stock_consumption_read on public.%I for select to authenticated using(finance_private.can_access(tenant_id))',t);
 execute format('create trigger preserve_stock_consumption before update or delete on public.%I for each row execute function finance_private.preserve_event()',t);
end loop;end$$;
alter table public.finance_stock_acquisition_dependencies drop constraint finance_stock_acquisition_dependencies_amount_cents_check;
alter table public.finance_stock_acquisition_dependencies add constraint finance_stock_acquisition_dependencies_amount_cents_check check(amount_cents>=0);
-- Deletion is allowed only by an already persisted, exact attribution reversal.
do $$declare body text;begin
 select pg_get_functiondef('finance_private.guard_stock_acquisition_dependency()'::regprocedure) into body;
 if position('if tg_op<>''INSERT'' then' in body)=0 then raise exception 'finance_stock_dependency_contract_changed';end if;
 body:=replace(body,'if tg_op<>''INSERT'' then', 'if tg_op=''DELETE'' and old.source_kind=''consumption_line'' then
 if not pg_try_advisory_xact_lock(hashtextextended(old.tenant_id::text||'':finance'',0)) then raise exception ''finance_stock_acquisition_concurrent_change'' using errcode=''40001'';end if;
 if exists(select 1 from public.finance_stock_consumption_lines source_line join public.finance_stock_consumption_reversals r on r.tenant_id=source_line.tenant_id and r.attribution_id=source_line.attribution_id where source_line.tenant_id=old.tenant_id and source_line.id=old.source_id and source_line.acquisition_link_id=old.acquisition_link_id and source_line.quantity=old.quantity and source_line.amount_cents=old.amount_cents) then return old;end if;
 end if;if tg_op<>''INSERT'' then');execute body;
end$$;
create function finance_private.stock_consumption_preview(_tenant uuid,_part uuid,_movement uuid,_lines jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare p public.maintenance_parts%rowtype;s public.stock_movements%rowtype;a public.finance_stock_acquisition_links%rowtype;line jsonb;rows jsonb:='[]';snap jsonb;issue text;q numeric;aq numeric;ac numeric;c numeric;totalq numeric:=0;totalc numeric:=0;ids uuid[]:='{}';declaredp numeric;declareds numeric;
begin
 if jsonb_typeof(_lines) is distinct from 'array' or jsonb_array_length(_lines) not between 1 and 100 then raise exception 'finance_stock_consumption_invalid_lines' using errcode='22023';end if;
 select * into p from public.maintenance_parts where tenant_id=_tenant and id=_part;select * into s from public.stock_movements where tenant_id=_tenant and id=_movement;
 if p.id is null or s.id is null then issue:='finance_stock_consumption_source_not_found';
 elsif p.stock_movement_id is distinct from s.id or p.stock_item_id is distinct from s.stock_item_id or p.maintenance_order_id is distinct from s.maintenance_order_id or p.quantity is distinct from s.quantity or s.movement_type is distinct from 'consumption' then issue:='finance_stock_consumption_source_mismatch';
 elsif not coalesce(p.quantity>0 and p.quantity::text not in('NaN','Infinity','-Infinity') and isfinite(s.moved_at),false) then issue:='finance_stock_consumption_invalid_quantity';
 elsif not exists(select 1 from public.stock_items where tenant_id=_tenant and id=s.stock_item_id) or not exists(select 1 from public.maintenance_orders where tenant_id=_tenant and id=p.maintenance_order_id and status='completed') then issue:='finance_stock_consumption_context_invalid';
 elsif exists(select 1 from finance_private.stock_consumption_claims where tenant_id=_tenant and (part_id=_part or consumption_movement_id=_movement)) or exists(select 1 from public.finance_maintenance_cost_claims where tenant_id=_tenant and source_kind='direct_part' and source_id=_part) then issue:='finance_stock_consumption_already_attributed';end if;
 for line in select value from jsonb_array_elements(_lines) order by value->>'acquisition_link_id' loop
 if jsonb_typeof(line) is distinct from 'object' or exists(select 1 from jsonb_object_keys(line) k where k not in('acquisition_link_id','quantity')) or jsonb_typeof(line->'quantity') is distinct from 'string' or coalesce(line->>'quantity','') !~ '^[0-9]+(\.[0-9]+)?$' or coalesce(line->>'acquisition_link_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'finance_stock_consumption_invalid_lines' using errcode='22023';end if;
 q:=(line->>'quantity')::numeric;if q<=0 or (line->>'acquisition_link_id')::uuid=any(ids) then raise exception 'finance_stock_consumption_invalid_lines' using errcode='22023';end if;ids:=array_append(ids,(line->>'acquisition_link_id')::uuid);totalq:=totalq+q;
 select * into a from public.finance_stock_acquisition_links where tenant_id=_tenant and id=(line->>'acquisition_link_id')::uuid;
 aq:=null;ac:=null;c:=null;
 if a.id is null or exists(select 1 from public.finance_stock_acquisition_reversals where tenant_id=_tenant and link_id=a.id) then issue:=coalesce(issue,'finance_stock_consumption_acquisition_inactive');
 elsif a.stock_item_id is distinct from s.stock_item_id or not exists(select 1 from public.stock_movements origin where origin.tenant_id=_tenant and origin.id=a.inbound_movement_id and isfinite(origin.moved_at) and origin.moved_at<=s.moved_at) then issue:=coalesce(issue,'finance_stock_consumption_acquisition_mismatch');
 else
 select a.quantity-coalesce(sum(quantity),0),a.amount_cents-coalesce(sum(amount_cents),0) into aq,ac from public.finance_stock_acquisition_dependencies where tenant_id=_tenant and acquisition_link_id=a.id;
 if aq<q or aq<=0 or ac<0 then issue:=coalesce(issue,'finance_stock_consumption_capacity_exceeded');else c:=case when q=aq then ac else floor(q*ac/aq) end;totalc:=totalc+c;end if;
 end if;
 rows:=rows||jsonb_build_array(jsonb_build_object('acquisition_link_id',(line->>'acquisition_link_id')::uuid,'quantity',trim_scale(q)::text,'amount_cents',case when c is not null then trunc(c)::text end,'available_quantity_before',case when aq is not null then trim_scale(aq)::text end,'available_cents_before',case when ac is not null then trunc(ac)::text end,'available_quantity_after',case when aq is not null then trim_scale(aq-q)::text end,'available_cents_after',case when c is not null then trunc(ac-c)::text end));
 end loop;
 if totalq is distinct from s.quantity then issue:=coalesce(issue,'finance_stock_consumption_quantity_mismatch');end if;
 declaredp:=case when p.total_cost::text not in('NaN','Infinity','-Infinity') and p.total_cost>=0 and p.total_cost*100=trunc(p.total_cost*100) and p.total_cost*100<=99999999999999 then p.total_cost*100 end;
 declareds:=case when s.total_cost::text not in('NaN','Infinity','-Infinity') and s.total_cost>=0 and s.total_cost*100=trunc(s.total_cost*100) and s.total_cost*100<=99999999999999 then s.total_cost*100 end;
 snap:=jsonb_build_object('part',to_jsonb(p),'movement',to_jsonb(s),'order',(select to_jsonb(o) from public.maintenance_orders o where o.tenant_id=_tenant and o.id=p.maintenance_order_id),'catalog',(select to_jsonb(i) from public.stock_items i where i.tenant_id=_tenant and i.id=s.stock_item_id),
 'acquisitions',(select coalesce(jsonb_agg(jsonb_build_object('link',to_jsonb(l),'snapshot',finance_private.stock_acquisition_snapshot(_tenant,l.inbound_movement_id,l.cost_id)) order by l.id),'[]') from public.finance_stock_acquisition_links l where l.tenant_id=_tenant and l.id=any(ids)),
 'history',(select coalesce(jsonb_agg(jsonb_build_object('attribution',to_jsonb(h),'reversal',(select to_jsonb(r) from public.finance_stock_consumption_reversals r where r.tenant_id=h.tenant_id and r.attribution_id=h.id)) order by h.id),'[]') from public.finance_stock_consumption_attributions h where h.tenant_id=_tenant and (h.part_id=_part or h.consumption_movement_id=_movement)),
 'policy','remaining_balance_floor_v1','lines',rows);
 return jsonb_build_object('version',1,'revision',md5(snap::text),'eligible',issue is null,'issue',issue,'policy','remaining_balance_floor_v1','quantity',trim_scale(totalq)::text,'declared_part_cents',case when declaredp is not null then trunc(declaredp)::text end,'declared_movement_cents',case when declareds is not null then trunc(declareds)::text end,'attributed_cents',case when issue is null then trunc(totalc)::text end,'discrepancy',declaredp is distinct from totalc or declareds is distinct from totalc,'lines',rows,'snapshot',snap);
end$$;
create function finance_private.stock_consumption_reversal_revision(_tenant uuid,_attribution uuid) returns text language sql stable set search_path='' as $$
select md5(jsonb_build_object('attribution',to_jsonb(a),'lines',(select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]') from public.finance_stock_consumption_lines l where l.tenant_id=_tenant and l.attribution_id=a.id),'dependencies',(select coalesce(jsonb_agg(to_jsonb(d) order by d.source_id),'[]') from public.finance_stock_acquisition_dependencies d where d.tenant_id=_tenant and d.source_kind='consumption_line' and exists(select 1 from public.finance_stock_consumption_lines l where l.tenant_id=d.tenant_id and l.id=d.source_id and l.attribution_id=a.id)),'reversal',(select to_jsonb(r) from public.finance_stock_consumption_reversals r where r.tenant_id=_tenant and r.attribution_id=a.id))::text) from public.finance_stock_consumption_attributions a where a.tenant_id=_tenant and a.id=_attribution
$$;
create function finance_private.stock_consumption_claim() returns trigger language plpgsql security definer set search_path='' as $$begin
 if not pg_try_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0)) then raise exception 'finance_stock_consumption_concurrent_change' using errcode='40001';end if;
 if tg_table_name='finance_stock_consumption_attributions' then insert into finance_private.stock_consumption_claims values(new.tenant_id,new.part_id,new.consumption_movement_id,new.id);
 elsif tg_table_name='finance_stock_consumption_lines' then
 if exists(select 1 from public.finance_stock_consumption_reversals where tenant_id=new.tenant_id and attribution_id=new.attribution_id) then raise exception 'finance_stock_consumption_already_reversed' using errcode='55000';end if;
 insert into public.finance_stock_acquisition_dependencies values(new.tenant_id,new.acquisition_link_id,'consumption_line',new.id,new.quantity,new.amount_cents);
 else
 delete from public.finance_stock_acquisition_dependencies d where d.tenant_id=new.tenant_id and d.source_kind='consumption_line' and exists(select 1 from public.finance_stock_consumption_lines l where l.tenant_id=d.tenant_id and l.id=d.source_id and l.attribution_id=new.attribution_id);
 delete from finance_private.stock_consumption_claims where tenant_id=new.tenant_id and attribution_id=new.attribution_id;
 end if;return new;
end$$;
create trigger stock_consumption_claim after insert on public.finance_stock_consumption_attributions for each row execute function finance_private.stock_consumption_claim();
create trigger stock_consumption_reserve after insert on public.finance_stock_consumption_lines for each row execute function finance_private.stock_consumption_claim();
create trigger stock_consumption_release after insert on public.finance_stock_consumption_reversals for each row execute function finance_private.stock_consumption_claim();
create function finance_private.manage_stock_consumption(_payload jsonb,_reverse boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;actor uuid:=auth.uid();actor_name text;part uuid;movement uuid;os uuid;item uuid;a public.finance_stock_consumption_attributions%rowtype;prior public.finance_commands%rowtype;preview jsonb;line jsonb;result jsonb;action text;reversal uuid;acquisition uuid;
begin
 if jsonb_typeof(_payload) is distinct from 'object' or _payload->'version' is distinct from '1'::jsonb or jsonb_typeof(_payload->'reason') is distinct from 'string' or length(btrim(_payload->>'reason')) not between 10 and 2000 or coalesce(_payload->>'revision','') !~ '^[0-9a-f]{32}$' or exists(select 1 from jsonb_object_keys(_payload) k where k<>all(case when _reverse then array['version','tenant_id','request_id','attribution_id','revision','reason'] else array['version','tenant_id','request_id','maintenance_part_id','consumption_movement_id','lines','revision','reason','same_stock_origin_confirmed','discrepancy_confirmed'] end)) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;
 if t is null or request is null or (not _reverse and (_payload->'same_stock_origin_confirmed' is distinct from 'true'::jsonb or jsonb_typeof(_payload->'discrepancy_confirmed') is distinct from 'boolean')) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 action:=case when _reverse then 'reverse_stock_consumption_attribution' else 'attribute_stock_consumption' end;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;if found then if prior.actor_id<>actor or prior.action<>action or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return prior.result;end if;
 if _reverse then
 select * into a from public.finance_stock_consumption_attributions where tenant_id=t and id=(_payload->>'attribution_id')::uuid;if not found then raise exception 'finance_stock_consumption_not_found' using errcode='22023';end if;part:=a.part_id;movement:=a.consumption_movement_id;os:=a.order_id;
 if exists(select 1 from public.finance_stock_consumption_reversals where tenant_id=t and attribution_id=a.id) then raise exception 'finance_stock_consumption_already_reversed' using errcode='23514';end if;
 else part:=(_payload->>'maintenance_part_id')::uuid;movement:=(_payload->>'consumption_movement_id')::uuid;select maintenance_order_id into os from public.maintenance_parts where tenant_id=t and id=part;end if;
 if part is null or movement is null then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 select stock_item_id into item from public.stock_movements where tenant_id=t and id=movement;
 perform 1 from public.stock_items where tenant_id=t and id=item for update;
 perform 1 from public.maintenance_orders where tenant_id=t and id=os for update;
 perform 1 from public.maintenance_parts where tenant_id=t and id=part for update;
 perform 1 from public.stock_movements where tenant_id=t and id=movement for update;
 if not _reverse then
 -- Validate shape before casting selected IDs. This preliminary preview does not authorize the write.
 preview:=finance_private.stock_consumption_preview(t,part,movement,_payload->'lines');
 for acquisition in select (value->>'acquisition_link_id')::uuid from jsonb_array_elements(_payload->'lines') order by 1 loop
 perform 1 from public.finance_stock_acquisition_links where tenant_id=t and id=acquisition for update;
 perform 1 from public.finance_expense_items c where tenant_id=t and id=(select cost_id from public.finance_stock_acquisition_links where tenant_id=t and id=acquisition) for update;
 perform 1 from public.clients c where tenant_id=t and id=(select supplier_id from public.finance_stock_acquisition_links where tenant_id=t and id=acquisition) for update;
 end loop;
 else perform 1 from public.finance_stock_acquisition_links l where tenant_id=t and exists(select 1 from public.finance_stock_consumption_lines x where x.tenant_id=t and x.attribution_id=a.id and x.acquisition_link_id=l.id) order by id for update;end if;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into actor_name from auth.users where id=actor;actor_name:=coalesce(actor_name,actor::text);
 if _reverse then
 if finance_private.stock_consumption_reversal_revision(t,a.id) is distinct from _payload->>'revision' then raise exception 'finance_stock_consumption_changed' using errcode='40001';end if;
 insert into public.finance_stock_consumption_reversals(tenant_id,attribution_id,actor_id,actor_name,reason) values(t,a.id,actor,actor_name,btrim(_payload->>'reason')) returning id into reversal;
 preview:=a.source_snapshot;
 else
 preview:=finance_private.stock_consumption_preview(t,part,movement,_payload->'lines');
 if preview->>'revision' is distinct from _payload->>'revision' then raise exception 'finance_stock_consumption_changed' using errcode='40001';end if;
 if preview->'eligible' is distinct from 'true'::jsonb then raise exception '%',preview->>'issue' using errcode='23514';end if;
 if preview->'discrepancy'='true'::jsonb and _payload->'discrepancy_confirmed' is distinct from 'true'::jsonb then raise exception 'finance_stock_consumption_discrepancy_confirmation_required' using errcode='23514';end if;
 preview:=preview||jsonb_build_object('same_stock_origin_confirmed',true,'discrepancy_confirmed',_payload->'discrepancy_confirmed');
 insert into public.finance_stock_consumption_attributions(tenant_id,part_id,consumption_movement_id,order_id,policy,revision,source_snapshot,actor_id,actor_name,reason) values(t,part,movement,os,'remaining_balance_floor_v1',_payload->>'revision',preview,actor,actor_name,btrim(_payload->>'reason')) returning * into a;
 for line in select value from jsonb_array_elements(preview->'lines') loop
 insert into public.finance_stock_consumption_lines(tenant_id,attribution_id,acquisition_link_id,quantity,amount_cents,balance_snapshot) values(t,a.id,(line->>'acquisition_link_id')::uuid,(line->>'quantity')::numeric,(line->>'amount_cents')::bigint,line);
 end loop;
 end if;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'attribution_id',a.id,'maintenance_part_id',part,'consumption_movement_id',movement,'order_id',os,'quantity',preview->>'quantity','attributed_cents',preview->>'attributed_cents','policy','remaining_balance_floor_v1','cash_changed',false,'cost_created',false,'obligation_created',false,'confirmed',true);
 if _reverse then result:=result||jsonb_build_object('reversal_id',reversal);end if;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(t,'stock_consumption',movement,case when _reverse then 'stock_consumption_attribution_reversed' else 'stock_consumption_attributed' end,actor,actor_name,btrim(_payload->>'reason'),a.source_snapshot,result||jsonb_build_object('manual_intervention',true));
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,action,_payload,result);return result;
end$$;
create function finance_private.protect_stock_consumption_source() returns trigger language plpgsql security definer set search_path='' as $$
declare t uuid;tenants uuid[];protected boolean;begin
 select array_agg(distinct x order by x) into tenants from unnest(array[old.tenant_id,case when tg_op='UPDATE' then new.tenant_id end]) x where x is not null;
 foreach t in array tenants loop if not pg_try_advisory_xact_lock(hashtextextended(t::text||':finance',0)) then raise exception 'finance_stock_consumption_concurrent_change' using errcode='40001';end if;end loop;
 select exists(select 1 from finance_private.stock_consumption_claims c join public.finance_stock_consumption_attributions a on a.tenant_id=c.tenant_id and a.id=c.attribution_id where c.tenant_id=old.tenant_id and (tg_table_name='maintenance_parts' and c.part_id=old.id or tg_table_name='stock_movements' and c.consumption_movement_id=old.id or tg_table_name='maintenance_orders' and a.order_id=old.id)) into protected;
 if protected then
 if tg_op='DELETE' then raise exception 'finance_stock_consumption_source_protected' using errcode='55000';end if;
 if tg_table_name='maintenance_orders' then
 if (new.id,new.tenant_id,new.status,new.vehicle_id,new.asset_id) is distinct from(old.id,old.tenant_id,old.status,old.vehicle_id,old.asset_id) then raise exception 'finance_stock_consumption_source_protected' using errcode='55000';end if;
 elsif to_jsonb(new)-array['notes','justification'] is distinct from to_jsonb(old)-array['notes','justification'] then raise exception 'finance_stock_consumption_source_protected' using errcode='55000';end if;
 end if;if tg_op='DELETE' then return old;end if;return new;
end$$;
create trigger stock_consumption_part_protected before update or delete on public.maintenance_parts for each row execute function finance_private.protect_stock_consumption_source();
create trigger stock_consumption_movement_protected before update or delete on public.stock_movements for each row execute function finance_private.protect_stock_consumption_source();
create trigger stock_consumption_order_protected before update or delete on public.maintenance_orders for each row execute function finance_private.protect_stock_consumption_source();
revoke all on function finance_private.stock_consumption_preview(uuid,uuid,uuid,jsonb),finance_private.stock_consumption_reversal_revision(uuid,uuid),finance_private.stock_consumption_claim(),finance_private.manage_stock_consumption(jsonb,boolean),finance_private.protect_stock_consumption_source() from public,anon,authenticated,service_role;
grant execute on function finance_private.manage_stock_consumption(jsonb,boolean) to authenticated;
create function public.attribute_finance_stock_consumption(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.manage_stock_consumption(_payload,false)$$;
create function public.reverse_finance_stock_consumption_attribution(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.manage_stock_consumption(_payload,true)$$;
revoke all on function public.attribute_finance_stock_consumption(jsonb),public.reverse_finance_stock_consumption_attribution(jsonb) from public,anon,service_role;
grant execute on function public.attribute_finance_stock_consumption(jsonb),public.reverse_finance_stock_consumption_attribution(jsonb) to authenticated;
