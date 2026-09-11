-- Diagnostic projection only. No balance is inferred and no period is closed
-- by equality of totals; coverage, anchors and legacy integration are separate.
create function finance_private.account_period_review(_tenant uuid,_account uuid,_from date,_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare result jsonb;account_name text;begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _from is null or _to is null or _to<_from or _to-_from>3660 then raise exception 'finance_invalid_period' using errcode='22023';end if;
 select name into account_name from public.bank_accounts where tenant_id=_tenant and id=_account;
 if not found then raise exception 'finance_account_not_found' using errcode='22023';end if;
 with entries as materialized(
  select e.* from public.finance_bank_entries e where e.tenant_id=_tenant and e.bank_account_id=_account and e.posted_on between _from and _to
   and finance_private.bank_entry_active(_tenant,e.id)
 ), movements as materialized(
  select * from public.finance_movements where tenant_id=_tenant and bank_account_id=_account and occurred_on between _from and _to
 ), groups as materialized(
  select g.*,finance_private.reconciliation_evidence_issue(_tenant,g.id) evidence_issue,
   exists(select 1 from public.finance_bank_entries e where e.tenant_id=_tenant and e.id=any(g.bank_entry_ids) and e.posted_on not between _from and _to)
    or exists(select 1 from public.finance_movements m where m.tenant_id=_tenant and m.id=any(g.movement_ids) and m.occurred_on not between _from and _to) crosses_period
  from public.finance_reconciliation_groups g where g.tenant_id=_tenant and g.bank_account_id=_account
   and (g.bank_entry_ids&&array(select id from entries) or g.movement_ids&&array(select id from movements))
   and not exists(select 1 from public.finance_reconciliation_reversals r where r.tenant_id=_tenant and r.group_id=g.id)
 ), valid_groups as materialized(select * from groups where evidence_issue is null and not crosses_period),
 bank_totals as(select count(*) count,count(*) filter(where amount_cents>0) in_count,count(*) filter(where amount_cents<0) out_count,
  coalesce(sum(amount_cents) filter(where amount_cents>0),0) in_cents,coalesce(-sum(amount_cents) filter(where amount_cents<0),0) out_cents from entries),
 movement_totals as(select count(*) count,count(*) filter(where direction='in') in_count,count(*) filter(where direction='out') out_count,
  coalesce(sum(amount_cents) filter(where direction='in'),0) in_cents,coalesce(sum(amount_cents) filter(where direction='out'),0) out_cents from movements)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'bank_account_id',_account,'account_name',account_name,'from',_from,'to',_to,
  'bank',jsonb_build_object('count',b.count,'in_count',b.in_count,'out_count',b.out_count,'in_cents',b.in_cents::text,'out_cents',b.out_cents::text,'net_cents',(b.in_cents-b.out_cents)::text),
  'recorded',jsonb_build_object('count',m.count,'in_count',m.in_count,'out_count',m.out_count,'in_cents',m.in_cents::text,'out_cents',m.out_cents::text,'net_cents',(m.in_cents-m.out_cents)::text),
  'difference',jsonb_build_object('in_cents',(m.in_cents-b.in_cents)::text,'out_cents',(m.out_cents-b.out_cents)::text,'net_cents',((m.in_cents-m.out_cents)-(b.in_cents-b.out_cents))::text),
  'unmatched_bank_count',(select count(*) from entries e where not exists(select 1 from valid_groups g where e.id=any(g.bank_entry_ids))),
  'unmatched_movement_count',(select count(*) from movements e where not exists(select 1 from valid_groups g where e.id=any(g.movement_ids))),
  'evidence_review_count',(select count(*) from groups where evidence_issue is not null),
  'cross_period_count',(select count(*) from groups where crosses_period),
  'manual_group_count',(select count(*) from groups where method='manual'),
  'unverified_entry_count',(select count(*) from entries e where (select v.outcome from public.finance_statement_verifications v where v.tenant_id=_tenant and v.import_id=e.first_import_id order by v.created_at desc,v.id desc limit 1) is distinct from 'rows_match'),
  'unresolved_row_count',(select count(*) from public.finance_statement_rows r join public.finance_statement_imports i on i.tenant_id=r.tenant_id and i.id=r.import_id
    where r.tenant_id=_tenant and i.bank_account_id=_account and (r.raw->>'posted_on')::date between _from and _to and r.classification in('ambiguous','reference_conflict','repeated_reference')
     and not exists(select 1 from public.finance_statement_identity_reviews ir where ir.tenant_id=_tenant and ir.row_id=r.id
      and not exists(select 1 from public.finance_statement_review_reversals rv where rv.tenant_id=_tenant and rv.review_id=ir.id))),
  'opening_balance_cents',null,'closing_balance_cents',null,'coverage_status','pending','legacy_integration_status','pending','can_close',false)
 into result from bank_totals b cross join movement_totals m;
 return result;
end;$$;
revoke all on function finance_private.account_period_review(uuid,uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function finance_private.account_period_review(uuid,uuid,date,date) to authenticated;
create function public.get_finance_account_period_review(_tenant_id uuid,_account_id uuid,_from date,_to date) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.account_period_review(_tenant_id,_account_id,_from,_to)$$;
revoke all on function public.get_finance_account_period_review(uuid,uuid,date,date) from public,anon,service_role;
grant execute on function public.get_finance_account_period_review(uuid,uuid,date,date) to authenticated;
