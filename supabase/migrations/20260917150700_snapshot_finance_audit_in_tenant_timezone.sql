create or replace function finance_private.audit_events(
  _tenant uuid,
  _filters jsonb default '{}'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  page integer := coalesce((_filters->>'page')::integer,1);
  size integer := coalesce((_filters->>'page_size')::integer,30);
  start_date date := nullif(_filters->>'from','')::date;
  end_date date := nullif(_filters->>'to','')::date;
  snapshot_at timestamptz := coalesce(nullif(_filters->>'snapshot_at','')::timestamptz, statement_timestamp());
  tenant_timezone text;
  result jsonb;
begin
  if not finance_private.can_access(_tenant) then
    raise exception 'finance_access_denied' using errcode='42501';
  end if;

  select case
    when exists (
      select 1 from pg_catalog.pg_timezone_names zone
      where zone.name = tenant.timezone
    ) then tenant.timezone
    else 'America/Sao_Paulo'
  end
  into tenant_timezone
  from public.tenants tenant
  where tenant.id = _tenant;
  tenant_timezone := coalesce(tenant_timezone,'America/Sao_Paulo');

  if jsonb_typeof(_filters) is distinct from 'object'
     or page not between 1 and 1000000
     or size not between 1 and 100
     or start_date>end_date
     or not isfinite(snapshot_at)
     or snapshot_at > statement_timestamp() + interval '5 minutes'
     or length(coalesce(_filters->>'search',''))>200
     or length(coalesce(_filters->>'actor_search',''))>200 then
    raise exception 'finance_invalid_audit_filters' using errcode='22023';
  end if;

  with filtered as materialized (
    select
      event.id,event.tenant_id,event.entity_type,event.entity_id,event.action,
      event.actor_id,event.actor_name,event.reason,event.created_at,
      (
        coalesce((event.after_data->>'manual_intervention')::boolean,false)
        or coalesce((event.after_data->>'manual')::boolean,false)
        or event.action in (
          'identity_reviewed_manually','identity_review_reversed','payable_movement_applied','payable_link_reversed',
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
          'payable_bulk_movement_confirmed','payroll_period_cancelled','payroll_period_reopened'
        )
      ) manual_intervention,
      event.after_data->>'decision' decision,
      nullif(event.after_data->>'row_id','') row_id
    from public.finance_events event
    where event.tenant_id=_tenant
      and event.created_at <= snapshot_at
      and (start_date is null or event.created_at >= start_date::timestamp at time zone tenant_timezone)
      and (end_date is null or event.created_at < (end_date+1)::timestamp at time zone tenant_timezone)
      and (nullif(_filters->>'action','') is null or event.action=_filters->>'action')
      and (nullif(_filters->>'actor_id','') is null or event.actor_id=(_filters->>'actor_id')::uuid)
      and position(lower(coalesce(_filters->>'actor_search','')) in lower(event.actor_name))>0
      and position(lower(coalesce(_filters->>'search','')) in lower(event.reason))>0
  ),
  selected as materialized (
    select * from filtered
    where not coalesce((_filters->>'manual_only')::boolean,false) or manual_intervention
  ),
  paged as (
    select * from selected
    order by created_at desc,id desc
    limit size offset (page-1)*size
  )
  select jsonb_build_object(
    'version',1,
    'tenant_id',_tenant,
    'page',page,
    'page_size',size,
    'total',(select count(*) from selected),
    'manual_count',(select count(*) from filtered where manual_intervention),
    'timezone',tenant_timezone,
    'snapshot_at',snapshot_at,
    'rows',coalesce((
      select jsonb_agg(
        to_jsonb(paged_row)||jsonb_build_object('statement_name',statement_import.file_name,'source_row',statement_row.source_row)
        order by paged_row.created_at desc,paged_row.id desc
      )
      from paged paged_row
      left join public.finance_statement_imports statement_import
        on paged_row.entity_type='statement_import'
       and statement_import.tenant_id=_tenant
       and statement_import.id=paged_row.entity_id
      left join public.finance_statement_rows statement_row
        on statement_row.tenant_id=_tenant
       and statement_row.id::text=paged_row.row_id
    ),'[]'::jsonb)
  ) into result;

  return result;
end;
$function$;

revoke all on function finance_private.audit_events(uuid,jsonb)
from public,anon,authenticated,service_role;
grant execute on function finance_private.audit_events(uuid,jsonb)
to authenticated;
