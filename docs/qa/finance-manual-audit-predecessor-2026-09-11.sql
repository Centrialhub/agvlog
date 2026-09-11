CREATE OR REPLACE FUNCTION finance_private.audit_events(_tenant uuid, _filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare page integer:=coalesce((_filters->>'page')::integer,1);size integer:=coalesce((_filters->>'page_size')::integer,30);
 start_date date:=nullif(_filters->>'from','')::date;end_date date:=nullif(_filters->>'to','')::date;result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if jsonb_typeof(_filters) is distinct from 'object' or page not between 1 and 1000000 or size not between 1 and 100 or start_date>end_date
   or length(coalesce(_filters->>'search',''))>200 or length(coalesce(_filters->>'actor_search',''))>200 then
   raise exception 'finance_invalid_audit_filters' using errcode='22023';end if;
 with filtered as materialized(select e.id,e.tenant_id,e.entity_type,e.entity_id,e.action,e.actor_id,e.actor_name,e.reason,e.created_at,
   e.action in('receipt_allocation_corrected','period_evidence_reviewed','settlement_payment_linked','settlement_link_reversed','account_opening_recorded','account_opening_reversed','cash_opening_recorded','statement_coverage_approved','statement_coverage_reversed','legacy_payable_associated','legacy_payable_association_reversed','legacy_receivable_associated','legacy_receivable_association_reversed','legacy_expense_cost_associated','legacy_expense_cost_association_reversed','maintenance_labor_associated','maintenance_labor_association_reversed','maintenance_direct_part_associated','maintenance_direct_part_association_reversed','account_period_closed','account_period_reopened','legacy_cut_reviewed','closed_period_composition_recorded','stock_acquisition_associated','stock_acquisition_association_reversed','stock_consumption_attributed','stock_consumption_attribution_reversed','cash_period_count_recorded','cash_period_count_reversed','cash_period_closed','expense_cancelled','manual_expense_cancelled','movement_voided','unloading_cost_corrected','unloading_cancelled_coordinated','unloading_origin_corrected','unloading_projection_repaired','identity_reviewed_manually','identity_review_reversed','bank_reconciled_manually','bank_reconciliation_reversed','payable_movement_applied','payable_link_reversed') manual_intervention,e.after_data->>'decision' decision,
   nullif(e.after_data->>'row_id','') row_id
   from public.finance_events e where e.tenant_id=_tenant
   and (start_date is null or e.created_at>=start_date::timestamp at time zone 'America/Sao_Paulo')
   and (end_date is null or e.created_at<(end_date+1)::timestamp at time zone 'America/Sao_Paulo')
   and (nullif(_filters->>'action','') is null or e.action=_filters->>'action')
   and (nullif(_filters->>'actor_id','') is null or e.actor_id=(_filters->>'actor_id')::uuid)
   and position(lower(coalesce(_filters->>'actor_search','')) in lower(e.actor_name))>0
   and position(lower(coalesce(_filters->>'search','')) in lower(e.reason))>0
   and (not coalesce((_filters->>'manual_only')::boolean,false) or e.action in('receipt_allocation_corrected','period_evidence_reviewed','settlement_payment_linked','settlement_link_reversed','account_opening_recorded','account_opening_reversed','cash_opening_recorded','statement_coverage_approved','statement_coverage_reversed','legacy_payable_associated','legacy_payable_association_reversed','legacy_receivable_associated','legacy_receivable_association_reversed','legacy_expense_cost_associated','legacy_expense_cost_association_reversed','maintenance_labor_associated','maintenance_labor_association_reversed','maintenance_direct_part_associated','maintenance_direct_part_association_reversed','account_period_closed','account_period_reopened','legacy_cut_reviewed','closed_period_composition_recorded','stock_acquisition_associated','stock_acquisition_association_reversed','stock_consumption_attributed','stock_consumption_attribution_reversed','cash_period_count_recorded','cash_period_count_reversed','cash_period_closed','expense_cancelled','manual_expense_cancelled','movement_voided','unloading_cost_corrected','unloading_cancelled_coordinated','unloading_origin_corrected','unloading_projection_repaired','identity_reviewed_manually','identity_review_reversed','bank_reconciled_manually','bank_reconciliation_reversed','payable_movement_applied','payable_link_reversed'))
 ), paged as(select * from filtered order by created_at desc,id desc limit size offset (page-1)*size)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'page',page,'page_size',size,'total',(select count(*) from filtered),
   'manual_count',(select count(*) from filtered where manual_intervention),'timezone','America/Sao_Paulo',
   'rows',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('statement_name',i.file_name,'source_row',sr.source_row) order by p.created_at desc,p.id desc)
     from paged p left join public.finance_statement_imports i on p.entity_type='statement_import' and i.tenant_id=_tenant and i.id=p.entity_id
     left join public.finance_statement_rows sr on sr.tenant_id=_tenant and sr.id::text=p.row_id),'[]')) into result;
 return result;
end;$function$
