create or replace function finance_private.settlement_expense_context_v2(
  _tenant uuid,
  _settlement uuid,
  _page integer default 1,
  _expected_revision text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  s public.driver_settlements%rowtype;
  result jsonb;
begin
  if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501'; end if;
  if _page is null or _page not between 1 and 100000 or (_expected_revision is not null and _expected_revision !~ '^[a-f0-9]{32}$') then
    raise exception 'finance_invalid_page' using errcode='22023';
  end if;
  select * into s from public.driver_settlements where tenant_id=_tenant and id=_settlement;
  if not found then raise exception 'finance_settlement_not_found' using errcode='22023'; end if;

  with raw_source as materialized(
    select e.id,e.batch_id,e.category,e.description,e.occurred_on,e.payable_id,
      finance_private.expense_cost_coverage(e.tenant_id,e.id) coverage,
      finance_private.expense_cost_effective(e.tenant_id,e.id) cost_origin,
      coalesce(a.cents,0) allocated,p.id title_id,p.status payable_status,p.supplier_name payee_name,p.amount title_amount,
      p.source_table,p.source_id,b.driver_id,
      trunc(coalesce(paid.amount,0)*100) paid,coalesce(paid.amount,0)*100<>trunc(coalesce(paid.amount,0)*100) paid_invalid,origin.payee_type original_payee
    from finance_private.active_expense_items e
    join public.finance_expense_batches b on b.id=e.batch_id and b.tenant_id=_tenant
    left join public.payables p on p.id=e.payable_id and p.tenant_id=_tenant
    left join lateral(select sum(amount_cents) cents from public.finance_expense_allocations where tenant_id=_tenant and expense_id=e.id) a on true
    left join lateral(select sum(amount) amount from finance_private.active_payable_payments where tenant_id=_tenant and payable_id=p.id) paid on true
    left join lateral(
      select case when count(*)=1 then min(line->>'payee_type') end payee_type
      from public.finance_commands c cross join lateral jsonb_array_elements(c.payload->'items') line
      where c.tenant_id=_tenant and c.action='record_expense_batch' and c.result->>'batch_id'=e.batch_id::text and line->>'id'=e.id::text
    ) origin on true
    where e.tenant_id=_tenant and b.context='trip' and b.trip_id=s.dispatch_trip_id
  ), source_rows as materialized(
    select *,
      case when cost_origin->'verified'='true'::jsonb and coalesce(cost_origin->>'effective_amount_cents','')~'^[0-9]{1,14}$'
        then (cost_origin->>'effective_amount_cents')::numeric end amount_cents,
      case when coverage->'verified'='true'::jsonb and coalesce(coverage->>'complement_cents','')~'^[0-9]{1,14}$'
        then (coverage->>'complement_cents')::numeric end complement
    from raw_source
  ), assessed as materialized(
    select *,case when complement=0 and payable_id is null then 'none' when original_payee in('driver','supplier') then original_payee else 'unknown' end payee_type,
      case when payable_status='cancelled' then 0 else greatest(complement-paid,0) end outstanding,
      (amount_cents is null or coverage->'verified' is distinct from 'true'::jsonb or paid_invalid or (coverage->>'allocation_applied_cents')::numeric>amount_cents or paid>complement or driver_id is distinct from s.driver_id
        or (complement>0 and (title_id is null or source_table is distinct from 'finance_expense_items' or source_id is distinct from id
          or title_amount*100 is distinct from complement or coalesce(original_payee,'') not in('driver','supplier') or payable_status='cancelled'))
        or (complement=0 and payable_id is not null)) needs_review
    from source_rows
  ), fingerprint as (
    select md5(coalesce(string_agg(md5(to_jsonb(a)::text),'' order by occurred_on desc,id),'')) revision
    from assessed a
  ), paged as (
    select * from assessed order by occurred_on desc,id limit 30 offset (_page-1)*30
  )
  select jsonb_build_object(
    'version',1,'tenant_id',_tenant,'settlement_id',s.id,'trip_id',s.dispatch_trip_id,'page',_page,'page_size',30,
    'revision',f.revision,
    'total',(select count(*) from assessed),
    'total_cents',(select case when bool_or(amount_cents is null or coverage->'verified' is distinct from 'true'::jsonb) then null else coalesce(sum(amount_cents),0)::text end from assessed),
    'allocated_cents',(select case when bool_or(amount_cents is null or coverage->'verified' is distinct from 'true'::jsonb) then null else coalesce(sum(allocated),0)::text end from assessed),
    'payable_cents',(select case when bool_or(amount_cents is null or coverage->'verified' is distinct from 'true'::jsonb) then null else coalesce(sum(complement),0)::text end from assessed),
    'paid_cents',(select case when bool_or(amount_cents is null or coverage->'verified' is distinct from 'true'::jsonb) then null else coalesce(sum(paid),0)::text end from assessed),
    'outstanding_cents',(select case when bool_or(amount_cents is null or coverage->'verified' is distinct from 'true'::jsonb) then null else coalesce(sum(outstanding),0)::text end from assessed),
    'needs_review_count',(select count(*) from assessed where needs_review),
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'batch_id',batch_id,'category',category,'description',description,'occurred_on',occurred_on,
      'coverage',coverage,'complement_cents',complement::text,'cost_origin',cost_origin,'amount_cents',amount_cents::text,'allocated_cents',allocated::text,'payable_id',payable_id,'payee_type',payee_type,'payee_name',payee_name,
      'payable_cents',complement::text,'paid_cents',paid::text,'outstanding_cents',outstanding::text,'payable_status',payable_status,'needs_review',needs_review
    ) order by occurred_on desc,id) from paged),'[]')
  ) into result
  from fingerprint f;

  if _expected_revision is not null and result->>'revision' is distinct from _expected_revision then
    raise exception 'finance_settlement_expense_context_changed' using errcode='40001';
  end if;
  return result;
end;
$function$;

revoke all on function finance_private.settlement_expense_context_v2(uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.settlement_expense_context_v2(uuid,uuid,integer,text) to authenticated;
