-- Canonical costs contribute to trip results, never to a second driver credit.
create function finance_private.canonical_trip_costs(_tenant uuid,_trip uuid)
returns table(source_id uuid,amount numeric,description text,metadata jsonb)
language sql stable security definer set search_path='' as $$
 select e.id,e.amount_cents::numeric/100,e.description,jsonb_build_object(
  'canonical_cost_version',1,'source_table','finance_expense_items','batch_id',b.id,
  'category',e.category,'occurred_on',e.occurred_on,'supplier_id',e.supplier_id,'supplier_name',e.supplier_name,
  'cost_center_id',e.cost_center_id,'receipt_path',e.receipt_path,'no_receipt_reason',e.no_receipt_reason,
  'payable_id',e.payable_id,'unloading_id',e.unloading_id,'approval_status','approved',
  'reimbursable',false,'settlement_credit_created',false,
  'allocation_total_cents',coalesce((select sum(a.amount_cents) from public.finance_expense_allocations a where a.tenant_id=_tenant and a.expense_id=e.id),0))
 from public.finance_expense_items e join public.finance_expense_batches b on b.id=e.batch_id and b.tenant_id=e.tenant_id
 where e.tenant_id=_tenant and b.context='trip' and b.trip_id=_trip;
$$;
revoke all on function finance_private.canonical_trip_costs(uuid,uuid) from public,anon,authenticated,service_role;

do $patch$declare body text;needle text;begin
 select pg_get_functiondef('public._build_driver_settlement(uuid,uuid)'::regprocedure) into body;
 body:=replace(body,E'\r\n',E'\n');
 needle:='  v_appr numeric := 0;';
 if position(needle in body)=0 then raise exception 'finance_settlement_builder_declaration_changed';end if;
 body:=replace(body,needle,needle||E'\n  v_canonical_cost numeric := 0;');
 needle:='WHERE dt.id = _dispatch_trip_id AND dt.tenant_id = _tenant_id;';
 if position(needle in body)=0 then raise exception 'finance_settlement_builder_trip_lock_changed';end if;
 body:=replace(body,needle,'WHERE dt.id = _dispatch_trip_id AND dt.tenant_id = _tenant_id FOR UPDATE NOWAIT;');
 needle:='WHERE tenant_id = _tenant_id AND dispatch_trip_id = _dispatch_trip_id;';
 -- This text also occurs in the expense aggregate; only the status SELECT is targeted.
 if position('FROM public.driver_settlements'||E'\n  '||needle in body)=0 then raise exception 'finance_settlement_builder_status_lock_changed';end if;
 body:=replace(body,'FROM public.driver_settlements'||E'\n  '||needle,'FROM public.driver_settlements'||E'\n  WHERE tenant_id = _tenant_id AND dispatch_trip_id = _dispatch_trip_id FOR UPDATE NOWAIT;');
 needle:='  -- Origin: prefer first linked load''s origin; else null';
 if position(needle in body)=0 then raise exception 'finance_settlement_builder_cost_anchor_changed';end if;
 body:=replace(body,needle,$addition$
  select coalesce(sum(c.amount),0) into v_canonical_cost from finance_private.canonical_trip_costs(_tenant_id,_dispatch_trip_id) c;
  v_appr:=v_appr+v_canonical_cost;
  v_exp_total:=v_exp_total+v_canonical_cost;
  -- v_appr_reimb is deliberately unchanged: unpaid canonical costs already own a payable.
$addition$||needle);
 -- Production can legitimately expose either the v2 builder or the later
 -- redelivery-aware v3 builder. Preserve that semantic base version and only
 -- mark the canonical-cost extension; every other structural anchor remains
 -- fail-closed above and below this compatibility branch.
 if position('''calculation_version'', ''driver_settlement_v3_attempts''' in body)>0 then
  body:=replace(body,
   '''calculation_version'', ''driver_settlement_v3_attempts''',
   '''calculation_version'', ''driver_settlement_v3_attempts_finance_costs''');
 elsif position('''calculation_version'', ''driver_settlement_v2''' in body)>0 then
  body:=replace(body,
   '''calculation_version'', ''driver_settlement_v2''',
   '''calculation_version'', ''driver_settlement_v2_finance_costs''');
 else
  raise exception 'finance_settlement_snapshot_version_changed';
 end if;
 needle:='    ''totals'', jsonb_build_object(';
 if position(needle in body)=0 then raise exception 'finance_settlement_snapshot_cost_anchor_changed';end if;
 body:=replace(body,needle,$snapshot$
    'canonical_expenses',coalesce((select jsonb_agg(to_jsonb(c) order by c.source_id) from finance_private.canonical_trip_costs(_tenant_id,_dispatch_trip_id) c),'[]'::jsonb),
    'canonical_settlement_credit_created',false,
$snapshot$||needle);
 needle:='      ''approved_expenses_total'', v_appr,';
 if position(needle in body)=0 then raise exception 'finance_settlement_totals_cost_anchor_changed';end if;
 body:=replace(body,needle,needle||E'\n      ''canonical_expenses_total'',v_canonical_cost,''expenses_total'',v_exp_total,');
 needle:='  IF v_estimated_km IS NOT NULL THEN';
 if position(needle in body)=0 then raise exception 'finance_settlement_items_cost_anchor_changed';end if;
 body:=replace(body,needle,$items$
  INSERT INTO public.driver_settlement_items(tenant_id,settlement_id,item_type,source_table,source_id,description,amount,quantity,metadata)
  SELECT _tenant_id,v_settlement_id,'expense','finance_expense_items',c.source_id,c.description,c.amount,null,c.metadata
  FROM finance_private.canonical_trip_costs(_tenant_id,_dispatch_trip_id) c;
$items$||needle);
 execute body;
end $patch$;

create function finance_private.mark_trip_cost_settlement_stale() returns trigger
language plpgsql security definer set search_path='' as $$declare trip uuid;s record;begin
 select b.trip_id into trip from public.finance_expense_batches b where b.tenant_id=new.tenant_id and b.id=new.batch_id and b.context='trip';
 if trip is null then return new;end if;
 -- Builder owns this trip row before reading costs. Batch already holds SHARE.
 -- Keep protected snapshots; simply make the new source pending review.
 for s in select id from public.driver_settlements where tenant_id=new.tenant_id and dispatch_trip_id=trip order by id for update nowait loop
  update public.driver_settlements set needs_recalculation=true,
   recalculation_reason=case when nullif(recalculation_reason,'') is null then 'canonical_trip_cost_added'
    when position('canonical_trip_cost_added' in recalculation_reason)>0 then recalculation_reason
    else recalculation_reason||';canonical_trip_cost_added' end where id=s.id;
 end loop;
 return new;
end$$;
revoke all on function finance_private.mark_trip_cost_settlement_stale() from public,anon,authenticated,service_role;
create trigger finance_trip_cost_settlement_stale after insert on public.finance_expense_items for each row execute function finance_private.mark_trip_cost_settlement_stale();

-- Extend, rather than bypass, the reimbursement source guard. Only the exact
-- canonical non-credit derivation is admitted. Other unknown sources still fail.
do $patch$declare body text;needle text;begin
 select pg_get_functiondef('finance_private.deduplicate_payroll_reimbursements(uuid,uuid)'::regprocedure) into body;
 body:=replace(body,E'\r\n',E'\n');
 needle:=$old$(x.source_table is distinct from 'driver_expenses' or x.source_id is null or x.metadata->>'approval_status' is null
       or jsonb_typeof(x.metadata->'reimbursable') is distinct from 'boolean')$old$;
 needle:=replace(needle,E'\r\n',E'\n');
 if position(needle in body)=0 then raise exception 'finance_payroll_canonical_source_contract_changed';end if;
 body:=replace(body,needle,$new$not coalesce((
   (x.source_table='driver_expenses' and x.source_id is not null and x.metadata->>'approval_status' is not null and jsonb_typeof(x.metadata->'reimbursable')='boolean')
   or (x.source_table='finance_expense_items' and x.metadata->'reimbursable'='false'::jsonb and x.metadata->'settlement_credit_created'='false'::jsonb
    and x.metadata->>'approval_status'='approved' and exists(select 1 from finance_private.canonical_trip_costs(_tenant,s.dispatch_trip_id) c
      where c.source_id=x.source_id and c.amount=x.amount and c.metadata->'payable_id' is not distinct from x.metadata->'payable_id'
       and c.metadata->'allocation_total_cents'=x.metadata->'allocation_total_cents'))),false)$new$);
 execute body;
end $patch$;
