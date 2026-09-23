create or replace function public.operations_dashboard_summary_v1(_tenant_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_timezone text;v_today date;v_delivered integer;v_unsuccessful integer;
begin
 if auth.uid() is null or not public.is_tenant_operator_or_admin(_tenant_id) then raise exception 'operator_required' using errcode='42501';end if;
 select coalesce(timezone,'America/Sao_Paulo') into v_timezone from public.tenants where id=_tenant_id;
 v_today:=(statement_timestamp() at time zone v_timezone)::date;
 select count(*) filter(where status='delivered'),count(*) filter(where status in('divergent','partial_delivery','returned','refused','failed')) into v_delivered,v_unsuccessful from public.loads where tenant_id=_tenant_id;
 return jsonb_build_object(
  'timezone',v_timezone,'today',v_today,
  'pending_orders',(select count(*)::integer from public.orders where tenant_id=_tenant_id and status not in('delivered','cancelled','returned','refused')),
  'delayed_orders',(select count(*)::integer from public.orders where tenant_id=_tenant_id and promised_date<v_today and status not in('delivered','cancelled','returned','refused')),
  'orders_by_status',(select coalesce(jsonb_agg(jsonb_build_object('status',status,'count',total) order by status),'[]'::jsonb) from(select status,count(*)::integer total from public.orders where tenant_id=_tenant_id group by status) grouped),
  'delayed_order_rows',(select coalesce(jsonb_agg(to_jsonb(row_data) order by promised_date,id),'[]'::jsonb) from(select orders.id,orders.order_number,orders.promised_date,orders.status,(v_today-orders.promised_date) days_overdue,jsonb_build_object('company_name',clients.company_name) clients from public.orders left join public.clients on clients.tenant_id=orders.tenant_id and clients.id=orders.client_id where orders.tenant_id=_tenant_id and orders.promised_date<v_today and orders.status not in('delivered','cancelled','returned','refused') order by orders.promised_date,orders.id limit 8) row_data),
  'active_loads',(select count(*)::integer from public.loads where tenant_id=_tenant_id and status not in('delivered','partial_delivery','returned','refused','failed','cancelled','divergent')),
  'in_transit_loads',(select count(*)::integer from public.loads where tenant_id=_tenant_id and status='in_transit'),
  'delivery_success_rate',case when v_delivered+v_unsuccessful=0 then null else round(v_delivered::numeric*100/(v_delivered+v_unsuccessful))::integer end,
  'open_incidents',(select count(*)::integer from public.incidents where tenant_id=_tenant_id and status not in('closed','cancelled','resolved')),
  'critical_incidents',(select count(*)::integer from public.incidents where tenant_id=_tenant_id and severity in('critical','high') and status not in('closed','cancelled','resolved')),
  'incident_cost',(select coalesce(sum(coalesce(actual_cost,estimated_cost,0)),0) from public.incidents where tenant_id=_tenant_id),
  'incident_rows',(select coalesce(jsonb_agg(to_jsonb(row_data) order by severity_rank,occurred_at desc,id),'[]'::jsonb) from(select incidents.id,incidents.incident_number,incidents.title,incidents.severity,incidents.status,incidents.occurred_at,case incidents.severity when 'critical' then 0 when 'high' then 1 else 2 end severity_rank from public.incidents where tenant_id=_tenant_id and status not in('closed','cancelled','resolved') order by severity_rank,occurred_at desc,id limit 8) row_data),
  'open_maintenance',(select count(*)::integer from public.maintenance_orders where tenant_id=_tenant_id and status not in('completed','closed','cancelled')),
  'maintenance_cost',(select coalesce(sum(total_cost),0) from public.maintenance_orders where tenant_id=_tenant_id),
  'maintenance_rows',(select coalesce(jsonb_agg(to_jsonb(row_data) order by opened_at desc,id),'[]'::jsonb) from(select maintenance.id,maintenance.order_number,maintenance.total_cost,maintenance.status,maintenance.opened_at,jsonb_build_object('plate',vehicles.plate) vehicles from public.maintenance_orders maintenance left join public.vehicles on vehicles.tenant_id=maintenance.tenant_id and vehicles.id=maintenance.vehicle_id where maintenance.tenant_id=_tenant_id and maintenance.status not in('completed','closed','cancelled') order by maintenance.opened_at desc,maintenance.id limit 8) row_data),
  'expiring_docs',(select count(*)::integer from public.employees where tenant_id=_tenant_id and status in('active','on_leave') and ((cnh_expiry is not null and cnh_expiry<v_today+30) or (medical_exam_expiry is not null and medical_exam_expiry<v_today+30))),
  'low_stock',(select count(*)::integer from public.stock_items where tenant_id=_tenant_id and active is distinct from false and coalesce(min_quantity,0)>0 and coalesce(current_quantity,0)<=min_quantity),
  'vehicle_occupancy_rows',(select coalesce(jsonb_agg(to_jsonb(row_data) order by occupancy desc,plate),'[]'::jsonb) from(select vehicles.id,vehicles.plate,vehicles.nickname,vehicles.max_pallets max_pallets,coalesce(sum(loads.total_pallet_count) filter(where loads.status in('loaded','in_transit')),0)::integer loaded_pallets,round(coalesce(sum(loads.total_pallet_count) filter(where loads.status in('loaded','in_transit')),0)::numeric*100/nullif(vehicles.max_pallets,0))::integer occupancy from public.vehicles left join public.loads on loads.tenant_id=vehicles.tenant_id and loads.vehicle_id=vehicles.id where vehicles.tenant_id=_tenant_id and vehicles.active is distinct from false and vehicles.max_pallets>0 group by vehicles.id,vehicles.plate,vehicles.nickname,vehicles.max_pallets order by occupancy desc,vehicles.plate limit 8) row_data)
 );
end;$function$;
revoke all on function public.operations_dashboard_summary_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.operations_dashboard_summary_v1(uuid) to authenticated;
