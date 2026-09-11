-- Forecast of unbilled service, never invoice merchandise value or bank money.
create function finance_private.unbilled_freight_rows(_tenant uuid)
returns table(document_id uuid,attempt_id uuid,client_id uuid,origin_date date,state text,freight_cents numeric,issues text[])
language sql stable set search_path='' as $$
with docs as materialized(
 select f.* from public.fiscal_documents f where f.tenant_id=_tenant and f.document_type='inbound'
), links as materialized(
 select d.id document_id,e.id emission_id,e.status,e.dispatch_state,e.doc_type,e.environment,
  e.authorization_protocol,e.access_key,e.hub_document_id
 from docs d join public.hub_fiscal_emissions e on e.tenant_id=_tenant and e.environment='production' and (
  e.fiscal_document_id=d.cte_emitted_outbound_id or e.nfse_document_id=d.nfse_emitted_document_id
  or exists(select 1 from public.fiscal_source_reservations s where s.tenant_id=_tenant and s.environment='production' and s.source_id=d.id
   and (s.outbound_id=e.fiscal_document_id or s.nfse_id=e.nfse_document_id))
  or exists(select 1 from public.cte_documents c where c.tenant_id=_tenant and c.id=e.cte_document_id and d.id=any(c.fiscal_document_ids))
  or exists(select 1 from public.nfse_documents n where n.tenant_id=_tenant and n.id=e.nfse_document_id and d.id=any(n.fiscal_document_ids))
  or exists(select 1 from public.finance_fiscal_observations o where o.tenant_id=_tenant and o.emission_id=e.id
   and ((o.snapshot#>'{cte,fiscal_document_ids}') @> jsonb_build_array(d.id) or (o.snapshot#>'{nfse,fiscal_document_ids}') @> jsonb_build_array(d.id)))
 )
), evidence as materialized(
 select d.*,
  (select count(*) from links l where l.document_id=d.id and l.status in('authorized','cancel_rejected') and l.dispatch_state='recorded') authorized,
  exists(select 1 from links l where l.document_id=d.id and l.status in('authorized','cancel_rejected') and (l.dispatch_state is distinct from 'recorded'
   or l.doc_type not in('cte','nfse') or nullif(l.authorization_protocol,'') is null or (l.doc_type='cte' and (coalesce(l.access_key,'') !~ '^[0-9]{44}$' or l.authorization_protocol !~ '^[0-9]{15}$'))
   or (l.doc_type='nfse' and nullif(l.hub_document_id,'') is null))) invalid_authorization,
  exists(select 1 from links l where l.document_id=d.id and l.dispatch_state in('in_flight','uncertain')) uncertain,
  exists(select 1 from links l where l.document_id=d.id and l.status in('pending','processing','transmitting','submitted','queued','issued','cancel_processing')) reserved,
  exists(select 1 from links l where l.document_id=d.id and (l.status is null or l.status not in('authorized','cancel_rejected','pending','processing','transmitting','submitted','queued','issued','cancel_processing','cancelled','denied','inutilized','rejected','draft','generated','error','failed','sefaz_error'))) unresolved_fiscal,
  exists(select 1 from links l where l.document_id=d.id and (l.status in('cancelled','denied','inutilized') or (l.status='rejected' and l.authorization_protocol is not null))) cancelled_fiscal,
  exists(select 1 from public.cte_documents c where c.tenant_id=_tenant and d.id=any(c.fiscal_document_ids)
    and not exists(select 1 from links l where l.document_id=d.id and l.emission_id in(select e.id from public.hub_fiscal_emissions e where e.tenant_id=_tenant and e.cte_document_id=c.id))
    and (c.status not in('draft','generated','rejected','error','failed','sefaz_error') or c.status is null)) legacy_cte,
  exists(select 1 from public.nfse_documents n where n.tenant_id=_tenant and d.id=any(n.fiscal_document_ids) and not n.is_preview
    and not exists(select 1 from links l where l.document_id=d.id and l.emission_id in(select e.id from public.hub_fiscal_emissions e where e.tenant_id=_tenant and e.nfse_document_id=n.id))
    and (n.status not in('draft','generated','rejected','error','failed','sefaz_error') or n.status is null)) legacy_nfse,
  (exists(select 1 from public.closing_report_charge_claims c where c.tenant_id=_tenant and c.fiscal_document_id=d.id and c.attempt_id is null and c.released_at is null)
   or exists(select 1 from public.client_invoice_charges c where c.tenant_id=_tenant and c.cancelled_at is null and
    ((c.source_type='cte_document' and exists(select 1 from public.cte_documents f where f.tenant_id=_tenant and f.id=c.source_id and d.id=any(f.fiscal_document_ids)))
     or (c.source_type='nfse_document' and exists(select 1 from public.nfse_documents f where f.tenant_id=_tenant and f.id=c.source_id and d.id=any(f.fiscal_document_ids)))))) claimed,
  exists(select 1 from docs other where other.id<>d.id and nullif(d.access_key,'') is not null and other.access_key=d.access_key and other.deleted_at is null and other.status<>'cancelled') duplicate_key
 from docs d
), originals as(
 select e.id document_id,null::uuid attempt_id,e.client_id,e.issue_date origin_date,
  case when e.status='cancelled' or e.deleted_at is not null then 'cancelled'
   when e.authorized>1 then 'review'
   when e.invalid_authorization then 'review'
   when e.unresolved_fiscal then 'review'
   when e.authorized=1 then 'authorized'
   when e.uncertain then 'uncertain'
   when e.cancelled_fiscal or e.legacy_cte or e.legacy_nfse then 'review'
   when (e.cte_emitted_at is not null or e.nfse_emitted_at is not null) and not exists(select 1 from links l where l.document_id=e.id) then 'review'
   when e.reserved then 'reserved'
   when e.claimed then 'review'
   when e.current_delivery_attempt_id is not null then 'review'
   when e.status in('returned','refused','partial_delivery','not_delivered') then 'review'
   when e.duplicate_key or e.is_duplicate then 'review'
   when e.client_id is null or not exists(select 1 from public.clients c where c.tenant_id=_tenant and c.id=e.client_id) then 'review'
   when e.issue_date is null or not isfinite(e.issue_date) then 'review'
   when e.freight_value is null or not (e.freight_value>0 and e.freight_value*100=trunc(e.freight_value*100) and e.freight_value*100<=99999999999999) then 'review'
   else 'available' end state,
  case when e.freight_value>0 and e.freight_value*100=trunc(e.freight_value*100) and e.freight_value*100<=99999999999999 then trunc(e.freight_value*100) end freight_cents,
  array_remove(array[
   case when e.authorized>1 then 'multiple_authorizations' end,
   case when e.invalid_authorization then 'authorization_evidence_invalid' end,
   case when e.unresolved_fiscal then 'fiscal_state_unknown' end,
   case when e.cancelled_fiscal then 'cancelled_service_requires_review' end,
   case when e.legacy_cte or e.legacy_nfse then 'legacy_fiscal_coverage_unconfirmed' end,
   case when (e.cte_emitted_at is not null or e.nfse_emitted_at is not null) and not exists(select 1 from links l where l.document_id=e.id) then 'fiscal_marker_without_source' end,
   case when e.claimed then 'commercial_claim_requires_allocation_review' end,
   case when e.current_delivery_attempt_id is not null then 'original_service_has_redelivery' end,
   case when e.status in('returned','refused','partial_delivery','not_delivered') then 'service_outcome_requires_pricing_review' end,
   case when e.duplicate_key or e.is_duplicate then 'duplicate_invoice_identity' end,
   case when e.client_id is null or not exists(select 1 from public.clients c where c.tenant_id=_tenant and c.id=e.client_id) then 'payer_unknown' end,
   case when e.issue_date is null or not isfinite(e.issue_date) then 'origin_date_unknown' end,
   case when e.freight_value is null or not (e.freight_value>0 and e.freight_value*100=trunc(e.freight_value*100) and e.freight_value*100<=99999999999999) then 'freight_unknown' end
  ],null) issues
 from evidence e
), attempts as(
 select a.fiscal_document_id,a.id,d.client_id,(a.recorded_at at time zone 'America/Sao_Paulo')::date,
  'review'::text,null::numeric,array['unpriced_redelivery']::text[]
 from public.delivery_attempts a join docs d on d.id=a.fiscal_document_id where a.tenant_id=_tenant and d.status<>'cancelled' and d.deleted_at is null
)
select * from originals union all select * from attempts
$$;
revoke all on function finance_private.unbilled_freight_rows(uuid) from public,anon,authenticated,service_role;

create function finance_private.unbilled_freight_summary(_tenant uuid,_from date,_to date,_client uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if (_from is not null and not isfinite(_from)) or (_to is not null and not isfinite(_to)) or _from>_to then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 if _client is not null and not exists(select 1 from public.clients c where c.tenant_id=_tenant and c.id=_client) then raise exception 'finance_client_not_found' using errcode='22023';end if;
 with selected as materialized(select * from finance_private.unbilled_freight_rows(_tenant) r
  where (_client is null or r.client_id=_client) and (r.origin_date is null or not isfinite(r.origin_date) or ((_from is null or r.origin_date>=_from) and (_to is null or r.origin_date<=_to)))),
 totals as(select count(*) total,count(*) filter(where state='available') available,count(*) filter(where state='reserved') reserved,
  count(*) filter(where state='uncertain') uncertain,count(*) filter(where state='authorized') authorized,count(*) filter(where state='review') review,
  count(*) filter(where state='cancelled') cancelled,count(*) filter(where origin_date is null or not isfinite(origin_date)) undated,
  coalesce(sum(freight_cents) filter(where state='available'),0) amount from selected),
 groups as(select state,count(*) origin_count,coalesce(sum(freight_cents) filter(where state='available'),0) amount from selected group by state),
 months as(select case when origin_date is not null and isfinite(origin_date) then to_char(origin_date,'YYYY-MM') end month_key,count(*) origin_count,coalesce(sum(freight_cents) filter(where state='available'),0) amount from selected group by 1)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'from',_from,'to',_to,'client_id',_client,'basis','per_nf_freight','date_basis','invoice_issue_or_attempt_recorded_date',
 'expected_receipt_date',null,'coverage_complete',false,'total_origins',t.total,'available_count',t.available,'reserved_count',t.reserved,'uncertain_count',t.uncertain,
 'authorized_count',t.authorized,'review_count',t.review,'cancelled_count',t.cancelled,'undated_count',t.undated,'totals_valid',t.review=0,
 'forecast_cents',case when t.review=0 then trunc(t.amount)::text end,
 'groups',coalesce((select jsonb_agg(jsonb_build_object('state',g.state,'origin_count',g.origin_count,'forecast_cents',case when t.review=0 then trunc(g.amount)::text end) order by g.state) from groups g),'[]'),
 'months',coalesce((select jsonb_agg(jsonb_build_object('month',m.month_key,'origin_count',m.origin_count,'forecast_cents',case when t.review=0 then trunc(m.amount)::text end) order by m.month_key nulls last) from months m),'[]'),
 'diagnostics',coalesce((select jsonb_object_agg(issue,n) from(select issue,count(*) n from selected cross join lateral unnest(issues) issue group by issue)x),'{}')) into result from totals t;
 return result;
end$$;
revoke all on function finance_private.unbilled_freight_summary(uuid,date,date,uuid) from public,anon,authenticated,service_role;
grant execute on function finance_private.unbilled_freight_summary(uuid,date,date,uuid) to authenticated;
create function public.get_finance_unbilled_freight_summary(_tenant_id uuid,_from date default null,_to date default null,_client_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.unbilled_freight_summary(_tenant_id,_from,_to,_client_id)$$;
revoke all on function public.get_finance_unbilled_freight_summary(uuid,date,date,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_unbilled_freight_summary(uuid,date,date,uuid) to authenticated;

create function finance_private.unbilled_freight_origins(_tenant uuid,_from date,_to date,_client uuid,_state text,_page integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if (_from is not null and not isfinite(_from)) or (_to is not null and not isfinite(_to)) or _from>_to or _page is null or _page not between 1 and 1000000
  or (_state is not null and _state not in('available','reserved','uncertain','authorized','review','cancelled')) then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 if _client is not null and not exists(select 1 from public.clients c where c.tenant_id=_tenant and c.id=_client) then raise exception 'finance_client_not_found' using errcode='22023';end if;
 with selected as materialized(select * from finance_private.unbilled_freight_rows(_tenant) r
  where (_client is null or r.client_id=_client) and (_state is null or r.state=_state)
   and (r.origin_date is null or not isfinite(r.origin_date) or ((_from is null or r.origin_date>=_from) and (_to is null or r.origin_date<=_to)))),
 paged as(select * from selected order by document_id,attempt_id nulls first limit 30 offset (_page-1)*30)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'from',_from,'to',_to,'client_id',_client,'state',_state,'page',_page,'page_size',30,'total',(select count(*) from selected),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('document_id',r.document_id,'attempt_id',r.attempt_id,'client_id',r.client_id,
   'origin_date',case when r.origin_date is not null and isfinite(r.origin_date) then to_char(r.origin_date,'YYYY-MM-DD') end,
   'date_basis',case when r.attempt_id is null then 'invoice_issue_date' else 'attempt_recorded_date' end,
   'state',r.state,'freight_cents',case when r.freight_cents is not null then trunc(r.freight_cents)::text end,'issues',to_jsonb(r.issues)) order by r.document_id,r.attempt_id nulls first) from paged r),'[]')) into result;
 return result;
end$$;
revoke all on function finance_private.unbilled_freight_origins(uuid,date,date,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function finance_private.unbilled_freight_origins(uuid,date,date,uuid,text,integer) to authenticated;
create function public.list_finance_unbilled_freight_origins(_tenant_id uuid,_from date default null,_to date default null,_client_id uuid default null,_state text default null,_page integer default 1)
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.unbilled_freight_origins(_tenant_id,_from,_to,_client_id,_state,_page)$$;
revoke all on function public.list_finance_unbilled_freight_origins(uuid,date,date,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_finance_unbilled_freight_origins(uuid,date,date,uuid,text,integer) to authenticated;
