-- Live bug queue 218, 223-238 and 241: canonical dates, tenant isolation,
-- idempotent aggregate commands, payroll lifecycle, filtered paging and snapshots.

-- Keep the operational coverage counters, but derive the recognized financial
-- amount from the same canonical expense date used by Recorded Costs.
alter function finance_private.recorded_cost_operational_coverage(uuid,date,date)
  rename to recorded_cost_operational_source_coverage;
create function finance_private.recorded_cost_operational_coverage(_tenant uuid,_from date,_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare result jsonb; recognized_count bigint; review_count bigint; recognized_amount numeric;
begin
 result:=finance_private.recorded_cost_operational_source_coverage(_tenant,_from,_to);
 with keys as materialized(
  select cost_id from public.finance_maintenance_cost_claims where tenant_id=_tenant
  union select cost_id from public.finance_legacy_expense_cost_links l where tenant_id=_tenant
    and not exists(select 1 from public.finance_legacy_expense_cost_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id)
 ), recognized as materialized(
  select e.id,not finance_private.expense_is_cancelled(_tenant,e.id) and finance_private.effective_cost_amount(_tenant,e.id) is not null valid,
   case when not finance_private.expense_is_cancelled(_tenant,e.id) then finance_private.effective_cost_amount(_tenant,e.id) end amount
  from keys k join public.finance_expense_items e on e.tenant_id=_tenant and e.id=k.cost_id
  where e.occurred_on is null or not isfinite(e.occurred_on)
    or ((_from is null or e.occurred_on>=_from) and (_to is null or e.occurred_on<=_to))
 ) select count(*),count(*) filter(where not valid),coalesce(sum(amount) filter(where valid),0)
 into recognized_count,review_count,recognized_amount from recognized;
 return result||jsonb_build_object('recognized_cost_count',recognized_count,'recognized_cost_needs_review_count',review_count,
  'recognized_cost_cents',case when review_count=0 then trunc(recognized_amount)::text end,'filter_scope','canonical_financial_period');
end;$fn$;
revoke all on function finance_private.recorded_cost_operational_coverage(uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function finance_private.recorded_cost_operational_coverage(uuid,date,date) to authenticated;

-- Restore legacy manual classifications while accepting the explicit event flag.
create or replace function finance_private.audit_events(_tenant uuid,_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare page integer:=coalesce((_filters->>'page')::integer,1);size integer:=coalesce((_filters->>'page_size')::integer,30);
 start_date date:=nullif(_filters->>'from','')::date;end_date date:=nullif(_filters->>'to','')::date;result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if jsonb_typeof(_filters) is distinct from 'object' or page not between 1 and 1000000 or size not between 1 and 100 or start_date>end_date
   or length(coalesce(_filters->>'search',''))>200 or length(coalesce(_filters->>'actor_search',''))>200 then raise exception 'finance_invalid_audit_filters' using errcode='22023';end if;
 with filtered as materialized(select e.id,e.tenant_id,e.entity_type,e.entity_id,e.action,e.actor_id,e.actor_name,e.reason,e.created_at,
   (coalesce((e.after_data->>'manual_intervention')::boolean,false) or coalesce((e.after_data->>'manual')::boolean,false)
    or e.action in('identity_reviewed_manually','identity_review_reversed','payable_movement_applied','payable_link_reversed',
    'bank_reconciled_manually','bank_reconciliation_reversed','receipt_allocation_corrected','internal_transfer_recorded',
    'manual_expense_recorded','legacy_expense_cost_associated','legacy_expense_cost_association_reversed',
    'maintenance_labor_associated','maintenance_labor_association_reversed','maintenance_direct_part_associated',
    'maintenance_direct_part_association_reversed','settlement_payment_linked','settlement_link_reversed',
    'period_evidence_reviewed','account_opening_recorded','account_opening_reversed','cash_opening_recorded',
    'statement_coverage_approved','statement_coverage_reversed','legacy_payable_associated','legacy_payable_association_reversed',
    'legacy_receivable_associated','legacy_receivable_association_reversed','closed_period_composition_recorded',
    'account_period_closed','account_period_reopened','cash_period_count_recorded','cash_period_count_reversed','cash_period_closed',
    'legacy_cut_reviewed','stock_consumption_attributed','stock_consumption_attribution_reversed','stock_acquisition_associated',
    'stock_acquisition_association_reversed','expense_cancelled','manual_expense_cancelled','movement_voided',
    'unloading_projection_repaired','unloading_origin_corrected','unloading_cancelled_coordinated','unloading_cost_corrected',
    'unloading_cost_regularized','cost_disposition_return_recorded','unloading_open_complement_corrected',
    'payable_approved_with_revision','cash_forecast_preserved','cash_forecast_agenda_set','cash_forecast_agenda_cleared',
    'customer_credit_applied','customer_credit_application_released','customer_credit_refunded','receivable_discount_applied',
    'receivable_loss_applied','receivable_balance_adjustment_reversed','payable_bulk_movement_applied',
    'payable_bulk_movement_confirmed','payroll_period_cancelled','payroll_period_reopened')) manual_intervention,
   e.after_data->>'decision' decision,nullif(e.after_data->>'row_id','') row_id
  from public.finance_events e where e.tenant_id=_tenant
   and (start_date is null or e.created_at>=start_date::timestamp at time zone 'America/Sao_Paulo')
   and (end_date is null or e.created_at<(end_date+1)::timestamp at time zone 'America/Sao_Paulo')
   and (nullif(_filters->>'action','') is null or e.action=_filters->>'action')
   and (nullif(_filters->>'actor_id','') is null or e.actor_id=(_filters->>'actor_id')::uuid)
   and position(lower(coalesce(_filters->>'actor_search','')) in lower(e.actor_name))>0
   and position(lower(coalesce(_filters->>'search','')) in lower(e.reason))>0
 ), selected as materialized(select * from filtered where not coalesce((_filters->>'manual_only')::boolean,false) or manual_intervention),
 paged as(select * from selected order by created_at desc,id desc limit size offset (page-1)*size)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'page',page,'page_size',size,'total',(select count(*) from selected),
  'manual_count',(select count(*) from filtered where manual_intervention),'timezone','America/Sao_Paulo',
  'rows',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('statement_name',i.file_name,'source_row',sr.source_row) order by p.created_at desc,p.id desc)
   from paged p left join public.finance_statement_imports i on p.entity_type='statement_import' and i.tenant_id=_tenant and i.id=p.entity_id
   left join public.finance_statement_rows sr on sr.tenant_id=_tenant and sr.id::text=p.row_id),'[]')) into result;
 return result;
end;$fn$;

create table finance_private.payroll_period_lifecycle_events(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,payroll_period_id uuid not null,
 action text not null check(action in('cancel','reopen')),affected_payable_ids uuid[] not null default '{}',
 actor_id uuid not null,reason text not null,created_at timestamptz not null default now()
);
create index payroll_period_lifecycle_latest on finance_private.payroll_period_lifecycle_events(tenant_id,payroll_period_id,created_at desc,id desc);
revoke all on finance_private.payroll_period_lifecycle_events from public,anon,authenticated,service_role;

create or replace function public.change_payroll_period_state(_period_id uuid,_action text,_reason text)
returns void language plpgsql security definer set search_path='' as $fn$
declare p public.payroll_periods%rowtype;actor uuid:=auth.uid();changed_ids uuid[]:='{}';restore_ids uuid[]:='{}';
begin
 if actor is null then raise exception 'authentication_required' using errcode='42501';end if;
 select * into p from public.payroll_periods where id=_period_id for update;
 if not found or not public.is_tenant_admin(p.tenant_id) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if coalesce(length(btrim(_reason)),0) not between 5 and 2000 or _action not in('cancel','reopen') then raise exception 'finance_invalid_payroll_lifecycle' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p.tenant_id::text||':finance',0));
 if exists(select 1 from public.payables q join finance_private.active_payable_payments pay on pay.tenant_id=q.tenant_id and pay.payable_id=q.id
  join public.payroll_entries e on e.tenant_id=q.tenant_id and e.id=q.source_id
  where q.tenant_id=p.tenant_id and q.source_table='payroll_entries' and e.payroll_period_id=p.id) then raise exception 'finance_payroll_has_payments' using errcode='55000';end if;
 perform set_config('app.payroll_lifecycle_command',p.tenant_id::text,true);
 if _action='cancel' then
  if p.status not in('draft','calculated','under_review','approved') then raise exception 'finance_payroll_cannot_cancel' using errcode='55000';end if;
  select coalesce(array_agg(q.id),'{}') into changed_ids from public.payables q join public.payroll_entries e on e.tenant_id=q.tenant_id and e.id=q.source_id
   where q.tenant_id=p.tenant_id and q.source_table='payroll_entries' and e.payroll_period_id=p.id and q.status<>'cancelled';
  update public.payables set status='cancelled',notes=concat_ws(E'\n',notes,'[Folha cancelada] '||btrim(_reason)),updated_at=now() where tenant_id=p.tenant_id and id=any(changed_ids);
  update public.payroll_entries set status='cancelled' where tenant_id=p.tenant_id and payroll_period_id=p.id;
  update public.payroll_periods set status='cancelled',notes=concat_ws(E'\n',notes,'[Cancelamento] '||btrim(_reason)),updated_at=now() where id=p.id;
 else
  if p.status<>'cancelled' then raise exception 'finance_payroll_cannot_reopen' using errcode='55000';end if;
  select affected_payable_ids into restore_ids from finance_private.payroll_period_lifecycle_events
   where tenant_id=p.tenant_id and payroll_period_id=p.id and action='cancel' order by created_at desc,id desc limit 1;
  update public.payables set status='pending',updated_at=now() where tenant_id=p.tenant_id and id=any(coalesce(restore_ids,'{}')) and status='cancelled';
  update public.payroll_entry_items set locked=false where tenant_id=p.tenant_id and payroll_period_id=p.id;
  update public.payroll_entries set status='calculated' where tenant_id=p.tenant_id and payroll_period_id=p.id;
  update public.payroll_periods set status='calculated',approved_by=null,approved_at=null,closed_by=null,closed_at=null,
   notes=concat_ws(E'\n',notes,'[Reabertura] '||btrim(_reason)),updated_at=now() where id=p.id;
 end if;
 insert into finance_private.payroll_period_lifecycle_events(tenant_id,payroll_period_id,action,affected_payable_ids,actor_id,reason)
 values(p.tenant_id,p.id,_action,case when _action='cancel' then changed_ids else coalesce(restore_ids,'{}') end,actor,btrim(_reason));
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(p.tenant_id,'payroll_period',p.id,'payroll_period_'||case when _action='cancel' then 'cancelled' else 'reopened' end,actor,
  coalesce((select full_name from public.profiles where id=actor),actor::text),btrim(_reason),to_jsonb(p),
  (select to_jsonb(x) from public.payroll_periods x where x.id=p.id)||jsonb_build_object('manual_intervention',true,'affected_payable_ids',case when _action='cancel' then changed_ids else coalesce(restore_ids,'{}') end));
end;$fn$;
revoke all on function public.change_payroll_period_state(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.change_payroll_period_state(uuid,text,text) to authenticated;

create function public.get_finance_payroll_period_page_v2(_tenant_id uuid,_page integer default 1,_page_size integer default 30,_filters jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare result jsonb;search_text text:=btrim(coalesce(_filters->>'search',''));status_filter text:=coalesce(nullif(_filters->>'status',''),'all');payment_filter text:=coalesce(nullif(_filters->>'payment',''),'all');
begin
 if not finance_private.can_access(_tenant_id) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if jsonb_typeof(_filters) is distinct from 'object' or _page not between 1 and 1000000 or _page_size not between 1 and 100 or length(search_text)>200
  or status_filter not in('all','draft','calculated','under_review','approved','closed','cancelled')
  or payment_filter not in('all','unpaid','partial','paid','review','cancelled') then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 with candidates as materialized(select p.id from public.payroll_periods p where p.tenant_id=_tenant_id
   and (status_filter='all' or p.status=status_filter)
   and (search_text='' or p.period_name ilike '%'||replace(replace(search_text,'\\','\\\\'),'%','\\%')||'%' escape '\\'
    or p.period_start::text ilike '%'||search_text||'%' or p.period_end::text ilike '%'||search_text||'%')),
 projected as materialized(select (finance_private.payroll_period_projection(_tenant_id,c.id)->'rows'->0) row from candidates c),
 matched as materialized(select row from projected where payment_filter='all' or row->>'payment_status'=payment_filter),
 paged as(select row from matched order by row->>'period_start' desc,row->>'id' limit _page_size offset (_page-1)*_page_size)
 select jsonb_build_object('version',1,'tenant_id',_tenant_id,'page',_page,'page_size',_page_size,'total',(select count(*) from matched),
  'rows',coalesce(jsonb_agg(row order by row->>'period_start' desc,row->>'id'),'[]'::jsonb)) into result from paged;
 return result;
end;$fn$;
revoke all on function public.get_finance_payroll_period_page_v2(uuid,integer,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_payroll_period_page_v2(uuid,integer,integer,jsonb) to authenticated;

-- Immutable billing snapshots always come from the authoritative tenant/client.
create or replace function public.tg_preserve_billing_snapshots_and_dates() returns trigger
language plpgsql security definer set search_path='' as $fn$
begin
 if new.due_date is not null and new.due_date<new.issue_date then raise exception 'invoice_due_before_issue' using errcode='23514';end if;
 select to_jsonb(c) into new.payer_snapshot from public.clients c where c.tenant_id=new.tenant_id and c.id=new.client_id;
 if new.payer_snapshot is null then raise exception 'invoice_client_not_found' using errcode='23503';end if;
 select jsonb_build_object('tenant_id',t.id,'name',t.name,'company',coalesce(t.settings->'company','{}'::jsonb)) into new.company_snapshot from public.tenants t where t.id=new.tenant_id;
 if new.company_snapshot is null then raise exception 'invoice_tenant_not_found' using errcode='23503';end if;
 return new;
end;$fn$;

alter table public.stock_movements add constraint stock_movements_type_supported
 check(movement_type in('inbound','outbound','transfer','return','reserve','adjustment','consumption')) not valid;
alter table public.route_templates add constraint route_templates_name_nonblank check(length(btrim(name))>0) not valid;

-- Request identities are stored on aggregate roots; a retry returns the first result.
alter table public.pickup_orders add column if not exists request_id uuid,add column if not exists request_hash text;
alter table public.vehicle_fueling add column if not exists request_id uuid,add column if not exists request_hash text;
alter table public.occurrence_report_import_batches add column if not exists request_id uuid,add column if not exists request_hash text;
alter table public.stock_movements add column if not exists request_id uuid,add column if not exists request_hash text;
alter table public.employee_contracts add column if not exists request_id uuid,add column if not exists request_hash text;
alter table public.route_templates add column if not exists request_id uuid,add column if not exists request_hash text;
create unique index pickup_orders_request_uidx on public.pickup_orders(tenant_id,request_id) where request_id is not null;
create unique index vehicle_fueling_request_uidx on public.vehicle_fueling(tenant_id,request_id) where request_id is not null;
create unique index occurrence_batches_request_uidx on public.occurrence_report_import_batches(tenant_id,request_id) where request_id is not null;
create unique index stock_movements_request_uidx on public.stock_movements(tenant_id,request_id) where request_id is not null;
create unique index employee_contracts_request_uidx on public.employee_contracts(tenant_id,request_id) where request_id is not null;
create unique index route_templates_request_uidx on public.route_templates(tenant_id,request_id) where request_id is not null;

-- Cross-tenant validations shared by the rewritten commands below.
create function finance_private.assert_tenant_reference(_table regclass,_tenant uuid,_id uuid,_label text) returns void
language plpgsql stable security definer set search_path='' as $fn$ declare ok boolean;begin
 if _id is null then return;end if;
 execute format('select exists(select 1 from %s where tenant_id=$1 and id=$2)',_table) into ok using _tenant,_id;
 if not ok then raise exception '%',_label||'_not_found_in_tenant' using errcode='23503';end if;
end;$fn$;
revoke all on function finance_private.assert_tenant_reference(regclass,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.assert_tenant_reference(regclass,uuid,uuid,text) to authenticated;
