-- Read-only prototype. $1 = tenant UUID. Full source graph, before account/date slicing.
-- Not an RPC, not a closing authorization, and not installed in the application.
with params as (select $1::uuid tenant_id),
advance_edges as (
 select a.id advance_id,p.id payable_id,'advance.payable_id'::text edge
 from public.employee_advances a join params t on t.tenant_id=a.tenant_id
 join public.payables p on p.tenant_id=a.tenant_id and p.id=a.payable_id where a.status='paid'
 union all
 select a.id,p.id,'payable.source_table/source_id'
 from public.employee_advances a join params t on t.tenant_id=a.tenant_id
 join public.payables p on p.tenant_id=a.tenant_id and p.source_table='employee_advances' and p.source_id=a.id where a.status='paid'
 union all
 select a.id,p.id,'advance.obligation_id→payable.source_id'
 from public.employee_advances a join params t on t.tenant_id=a.tenant_id
 join public.financial_obligations o on o.tenant_id=a.tenant_id and o.id=a.financial_obligation_id
  and o.source_table='employee_advances' and o.source_id=a.id
 join public.payables p on p.tenant_id=a.tenant_id and p.source_table='financial_obligations' and p.source_id=o.id where a.status='paid'
),titles as (
 select e.advance_id,e.payable_id,array_agg(distinct e.edge order by e.edge) edges
 from advance_edges e group by e.advance_id,e.payable_id
),legs as (
 select e.advance_id,e.payable_id,e.edges,p.source_table title_source,p.source_id title_source_id,p.amount title_amount,
  pp.id payment_id,pp.amount,pp.bank_account_id,(pp.paid_at at time zone 'America/Sao_Paulo')::date occurred_on,
  l.id link_id,l.origin,l.amount_cents,m.id movement_id,
  coalesce(pp.id is not null and l.id is not null and m.id is not null and l.payable_id=p.id
   and pp.amount>0 and pp.amount*100=trunc(pp.amount*100) and pp.amount*100<=99999999999999
   and l.amount_cents=pp.amount*100 and m.bank_account_id=pp.bank_account_id and m.direction='out' and m.nature<>'transfer'
   and isfinite(pp.paid_at) and m.occurred_on=(pp.paid_at at time zone 'America/Sao_Paulo')::date,false) exact_monetary_leg
 from titles e join public.payables p on p.id=e.payable_id join params t on t.tenant_id=p.tenant_id
 left join finance_private.active_payable_payments pp on pp.tenant_id=p.tenant_id and pp.payable_id=p.id
 left join public.finance_payable_movement_links l on l.tenant_id=pp.tenant_id and l.payment_id=pp.id
  and not exists(select 1 from public.finance_payable_link_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id)
 left join public.finance_movements m on m.tenant_id=l.tenant_id and m.id=l.movement_id
),advance_candidates as (
 select a.id source_id,a.employee_id,a.driver_id,a.advance_date,a.paid_at,a.amount declared_amount,
  (select count(*) from titles x where x.advance_id=a.id) title_count,
  (select count(*) from legs x where x.advance_id=a.id and x.payment_id is not null) payment_leg_count,
  (select coalesce(sum(x.amount),0) from legs x where x.advance_id=a.id) active_paid_amount,
  exists(select 1 from public.employees e where e.tenant_id=a.tenant_id and e.id=a.employee_id
   and a.driver_id is not distinct from e.driver_id) employee_identity_matches,
  coalesce((select jsonb_agg(to_jsonb(x) order by payable_id,payment_id,link_id) from legs x where x.advance_id=a.id),'[]') legs,
  -- This is only a necessary-condition diagnostic. It still needs full capacity,
  -- bank-source integrity, ambiguous-link and source-snapshot validation from B.
  coalesce((select count(*)=1 from titles x where x.advance_id=a.id)
   and exists(select 1 from legs x where x.advance_id=a.id and x.payment_id is not null)
   and not exists(select 1 from legs x where x.advance_id=a.id and
    (not x.exact_monetary_leg or x.title_amount is distinct from a.amount
     or x.title_source is distinct from 'employee_advances' or x.title_source_id is distinct from a.id))
   and (select sum(x.amount) from legs x where x.advance_id=a.id)=a.amount,false) necessary_money_conditions
 from public.employee_advances a join params t on t.tenant_id=a.tenant_id where a.status='paid'
),already_paid_candidates as (
 select x.id source_id,x.payroll_entry_id,x.payroll_period_id,x.employee_id,x.driver_id,x.source_table,x.source_id monetary_source_id,
  x.amount,x.competence_date,x.occurred_at,x.source_metadata,
  pe.id is not null and pp.id is not null and emp.id is not null
   and pe.employee_id=x.employee_id and pe.payroll_period_id=x.payroll_period_id
   and x.driver_id is not distinct from coalesce(pe.driver_id,emp.driver_id) parent_identity_matches,
  case x.source_table when 'employee_advances' then 'advance→title→active payments→canonical movements'
   when 'driver_settlement_payments' then 'payment→active settlement link→driver movement'
   when 'payables_payments' then 'payment→title: producer absent; reject circular payroll title payment'
   else 'unsupported source' end required_chain,
  case x.source_table
   when 'employee_advances' then (select to_jsonb(a) from public.employee_advances a where a.tenant_id=x.tenant_id and a.id=x.source_id)
   when 'driver_settlement_payments' then (select to_jsonb(p) from public.driver_settlement_payments p where p.tenant_id=x.tenant_id and p.id=x.source_id)
   when 'payables_payments' then (select to_jsonb(p) from public.payables_payments p where p.tenant_id=x.tenant_id and p.id=x.source_id)
  end source_record,
  (select count(*) from public.payroll_entry_items other where other.tenant_id=x.tenant_id and other.nature='already_paid'
   and other.employee_id=x.employee_id and other.source_table=x.source_table and other.source_id=x.source_id) same_source_item_count
 from public.payroll_entry_items x join params t on t.tenant_id=x.tenant_id
 left join public.payroll_entries pe on pe.tenant_id=x.tenant_id and pe.id=x.payroll_entry_id
 left join public.payroll_periods pp on pp.tenant_id=x.tenant_id and pp.id=x.payroll_period_id
 left join public.employees emp on emp.tenant_id=x.tenant_id and emp.id=x.employee_id
 where x.nature='already_paid'
)
select jsonb_build_object('version',1,'diagnostic_only',true,
 'advance_candidates',coalesce((select jsonb_agg(to_jsonb(x) order by source_id) from advance_candidates x),'[]'),
 'already_paid_candidates',coalesce((select jsonb_agg(to_jsonb(x) order by source_id) from already_paid_candidates x),'[]'));
