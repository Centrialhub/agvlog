-- Forward reconciliation for the verified production database (2026-09-22).
-- Sixteen frontend RPC contracts, their narrow dependencies and runtime fixes.
-- Do not replay the divergent local migration history against production.
-- No financial rows are created, settled, deleted or rewritten by this migration.
set local lock_timeout = '5s';
set local statement_timeout = '90s';

-- Source contract: 20260915184553_finance_legacy_reconciliation_read_model.sql
-- Additive, read-only projection for the historical bank reconciliation screen.
-- This does not certify legacy matches and does not mutate ledger or fiscal data.
create index if not exists idx_bank_transactions_legacy_page
  on public.bank_transactions (tenant_id, bank_account_id, posted_at desc, id desc);

create index if not exists idx_financial_obligations_legacy_page
  on public.financial_obligations (
    tenant_id,
    (coalesce(due_date, '9999-12-31'::date)),
    id
  );

create or replace function finance_private.legacy_reconciliation_summary(
  _tenant uuid,
  _bank_account uuid,
  _period_start date,
  _period_end date
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not finance_private.can_access(_tenant) then
    raise exception 'finance_access_denied' using errcode = '42501';
  end if;
  if _bank_account is null or _period_start is null or _period_end is null
    or _period_start > _period_end or _period_end - _period_start > 3660 then
    raise exception 'finance_invalid_legacy_reconciliation_filters' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.bank_accounts
    where tenant_id = _tenant and id = _bank_account
  ) then
    raise exception 'finance_bank_account_not_found' using errcode = '22023';
  end if;

  with transactions as materialized (
    select t.id, t.amount, t.transaction_type, t.reconciliation_status
    from public.bank_transactions t
    where t.tenant_id = _tenant
      and t.bank_account_id = _bank_account
      and t.posted_at >= (_period_start::timestamp at time zone 'America/Sao_Paulo')
      and t.posted_at < ((_period_end + 1)::timestamp at time zone 'America/Sao_Paulo')
  ), obligations as materialized (
    select o.id, o.obligation_type, o.open_balance, o.matching_status, o.status
    from public.financial_obligations o
    where o.tenant_id = _tenant
      and (o.due_date is null or o.due_date between _period_start and _period_end)
  ), transaction_stats as (
    select
      count(*)::integer as transaction_count,
      round(coalesce(sum(abs(amount)) filter (where transaction_type = 'credit'), 0) * 100)::bigint::text as inflow_cents,
      round(coalesce(sum(abs(amount)) filter (where transaction_type = 'debit'), 0) * 100)::bigint::text as outflow_cents,
      count(*) filter (where reconciliation_status = 'matched')::integer as matched_count,
      count(*) filter (where reconciliation_status in ('unmatched', 'suggested'))::integer as pending_count,
      count(*) filter (where reconciliation_status = 'unmatched')::integer as unmatched_transaction_count
    from transactions
  ), obligation_stats as (
    select
      count(*)::integer as obligation_count,
      count(*) filter (
        where matching_status = 'unmatched' and status not in ('paid', 'cancelled')
      )::integer as unmatched_obligation_count,
      count(*) filter (where obligation_type = 'driver_settlement_payment')::integer as driver_settlement_count,
      count(*) filter (where obligation_type = 'driver_expense')::integer as driver_expense_count,
      round(coalesce(sum(open_balance) filter (where obligation_type = 'driver_settlement_payment'), 0) * 100)::bigint::text as driver_pending_cents
    from obligations
  ), suggestion_stats as (
    select count(*)::integer as suggestion_count
    from public.financial_matches m
    join transactions t on t.id = m.bank_transaction_id
    where m.tenant_id = _tenant and m.status = 'suggested'
  )
  select jsonb_build_object(
    'version', 1,
    'tenant_id', _tenant,
    'bank_account_id', _bank_account,
    'period_start', _period_start,
    'period_end', _period_end,
    'transaction_count', tx.transaction_count,
    'inflow_cents', tx.inflow_cents,
    'outflow_cents', tx.outflow_cents,
    'matched_count', tx.matched_count,
    'pending_count', tx.pending_count,
    'unmatched_transaction_count', tx.unmatched_transaction_count,
    'obligation_count', ob.obligation_count,
    'unmatched_obligation_count', ob.unmatched_obligation_count,
    'suggestion_count', sg.suggestion_count,
    'driver_settlement_count', ob.driver_settlement_count,
    'driver_expense_count', ob.driver_expense_count,
    'driver_pending_cents', ob.driver_pending_cents
  ) into result
  from transaction_stats tx cross join obligation_stats ob cross join suggestion_stats sg;
  return result;
end;
$$;

revoke all on function finance_private.legacy_reconciliation_summary(uuid, uuid, date, date)
  from public, anon, authenticated, service_role;

create or replace function public.get_finance_legacy_reconciliation_summary(
  _tenant_id uuid,
  _bank_account_id uuid,
  _period_start date,
  _period_end date
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select finance_private.legacy_reconciliation_summary(
    _tenant_id, _bank_account_id, _period_start, _period_end
  );
$$;

revoke all on function public.get_finance_legacy_reconciliation_summary(uuid, uuid, date, date)
  from public, anon, authenticated, service_role;
grant execute on function public.get_finance_legacy_reconciliation_summary(uuid, uuid, date, date),
  finance_private.legacy_reconciliation_summary(uuid, uuid, date, date)
  to authenticated;

create or replace function finance_private.legacy_reconciliation_rows(
  _tenant uuid,
  _bank_account uuid,
  _period_start date,
  _period_end date,
  _kind text,
  _view text,
  _search text,
  _status text,
  _direction text,
  _cursor jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  page_rows jsonb;
  has_more boolean;
  next_cursor jsonb;
  cursor_id uuid;
  cursor_posted_at timestamptz;
  cursor_due_date date;
begin
  if not finance_private.can_access(_tenant) then
    raise exception 'finance_access_denied' using errcode = '42501';
  end if;
  if _bank_account is null or _period_start is null or _period_end is null
    or _period_start > _period_end or _period_end - _period_start > 3660
    or _kind not in ('transactions', 'obligations')
    or length(coalesce(_search, '')) > 200 then
    raise exception 'finance_invalid_legacy_reconciliation_filters' using errcode = '22023';
  end if;
  if (_kind = 'transactions' and _view not in ('all', 'unmatched'))
    or (_kind = 'obligations' and _view not in ('all', 'unmatched', 'drivers'))
    or _status not in ('all', 'unmatched', 'suggested', 'matched', 'ignored', 'manual_review')
    or _direction not in ('all', 'credit', 'debit')
    or (_kind = 'obligations' and (_status <> 'all' or _direction <> 'all')) then
    raise exception 'finance_invalid_legacy_reconciliation_filters' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.bank_accounts
    where tenant_id = _tenant and id = _bank_account
  ) then
    raise exception 'finance_bank_account_not_found' using errcode = '22023';
  end if;
  if _cursor is not null then
    if jsonb_typeof(_cursor) <> 'object'
      or not (_cursor ? 'id')
      or exists (
        select 1 from jsonb_object_keys(_cursor) key
        where key not in ('id', 'posted_at', 'due_date_key')
      )
      or (_kind = 'transactions' and (not (_cursor ? 'posted_at') or _cursor ? 'due_date_key'))
      or (_kind = 'obligations' and (not (_cursor ? 'due_date_key') or _cursor ? 'posted_at')) then
      raise exception 'finance_invalid_legacy_reconciliation_cursor' using errcode = '22023';
    end if;
    begin
      cursor_id := (_cursor ->> 'id')::uuid;
      if _kind = 'transactions' then
        cursor_posted_at := (_cursor ->> 'posted_at')::timestamptz;
      else
        cursor_due_date := (_cursor ->> 'due_date_key')::date;
      end if;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'finance_invalid_legacy_reconciliation_cursor' using errcode = '22023';
    end;
  end if;

  if _kind = 'transactions' then
    with filtered as materialized (
      select t.id, t.tenant_id, t.bank_account_id, t.posted_at, t.description,
        t.amount, t.transaction_type, t.reconciliation_status,
        t.document_number, t.cost_center
      from public.bank_transactions t
      where t.tenant_id = _tenant
        and t.bank_account_id = _bank_account
        and t.posted_at >= (_period_start::timestamp at time zone 'America/Sao_Paulo')
        and t.posted_at < ((_period_end + 1)::timestamp at time zone 'America/Sao_Paulo')
        and (_view = 'all' or t.reconciliation_status = 'unmatched')
        and (_status = 'all' or t.reconciliation_status = _status)
        and (_direction = 'all' or t.transaction_type = _direction)
        and (_cursor is null or (t.posted_at, t.id) < (cursor_posted_at, cursor_id))
        and position(lower(coalesce(_search, '')) in lower(
          coalesce(t.description, '') || ' ' || coalesce(t.document_number, '') || ' '
          || coalesce(t.counterparty_name, '') || ' ' || coalesce(t.cost_center, '')
        )) > 0
    ), candidates as materialized (
      select * from filtered
      order by posted_at desc, id desc
      limit 51
    ), paged as materialized (
      select * from candidates
      order by posted_at desc, id desc
      limit 50
    )
    select
      (select count(*) > 50 from candidates),
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'tenant_id', p.tenant_id,
            'bank_account_id', p.bank_account_id,
            'posted_at', p.posted_at,
            'description', p.description,
            'amount', p.amount,
            'transaction_type', p.transaction_type,
            'reconciliation_status', p.reconciliation_status,
            'document_number', p.document_number,
            'cost_center', p.cost_center,
            'suggestions', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', m.id,
                  'bank_transaction_id', m.bank_transaction_id,
                  'financial_obligation_id', m.financial_obligation_id,
                  'amount_matched', m.amount_matched,
                  'obligation', case when o.id is null then null else jsonb_build_object(
                    'id', o.id,
                    'description', o.description,
                    'counterparty_name', o.counterparty_name,
                    'amount_expected', o.amount_expected,
                    'open_balance', o.open_balance
                  ) end
                ) order by m.created_at desc, m.id desc
              )
              from public.financial_matches m
              left join public.financial_obligations o
                on o.tenant_id = m.tenant_id and o.id = m.financial_obligation_id
              where m.tenant_id = _tenant
                and m.bank_transaction_id = p.id
                and m.status = 'suggested'
            ), '[]'::jsonb)
          ) order by p.posted_at desc, p.id desc
        ) from paged p
      ), '[]'::jsonb),
      (select jsonb_build_object('posted_at', p.posted_at, 'id', p.id)
        from paged p order by p.posted_at asc, p.id asc limit 1)
    into has_more, page_rows, next_cursor;
  else
    with filtered as materialized (
      select o.id, o.tenant_id, o.due_date, o.obligation_type, o.description,
        o.counterparty_name, o.amount_expected, o.amount_matched, o.open_balance,
        o.status, o.matching_status
      from public.financial_obligations o
      where o.tenant_id = _tenant
        and (o.due_date is null or o.due_date between _period_start and _period_end)
        and (_view = 'all' or (_view = 'unmatched'
          and o.matching_status = 'unmatched' and o.status not in ('paid', 'cancelled'))
          or (_view = 'drivers'
            and o.obligation_type in ('driver_settlement_payment', 'driver_expense')))
        -- Null due dates sort after dated obligations through the documented
        -- 9999-12-31 key; id is always the deterministic tie-breaker.
        and (_cursor is null or (coalesce(o.due_date, '9999-12-31'::date), o.id)
          > (cursor_due_date, cursor_id))
        and position(lower(coalesce(_search, '')) in lower(
          coalesce(o.description, '') || ' ' || coalesce(o.counterparty_name, '')
        )) > 0
    ), candidates as materialized (
      select *, coalesce(due_date, '9999-12-31'::date) as due_date_key
      from filtered
      order by coalesce(due_date, '9999-12-31'::date) asc, id asc
      limit 51
    ), paged as materialized (
      select * from candidates
      order by due_date_key asc, id asc
      limit 50
    )
    select
      (select count(*) > 50 from candidates),
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'tenant_id', p.tenant_id,
            'due_date', p.due_date,
            'obligation_type', p.obligation_type,
            'description', p.description,
            'counterparty_name', p.counterparty_name,
            'amount_expected', p.amount_expected,
            'amount_matched', p.amount_matched,
            'open_balance', p.open_balance,
            'status', p.status,
            'matching_status', p.matching_status
          ) order by p.due_date_key asc, p.id asc
        ) from paged p
      ), '[]'::jsonb),
      (select jsonb_build_object('due_date_key', p.due_date_key, 'id', p.id)
        from paged p order by p.due_date_key desc, p.id desc limit 1)
    into has_more, page_rows, next_cursor;
  end if;

  if not has_more then next_cursor := null; end if;

  return jsonb_build_object(
    'version', 1,
    'tenant_id', _tenant,
    'bank_account_id', _bank_account,
    'period_start', _period_start,
    'period_end', _period_end,
    'kind', _kind,
    'view', _view,
    'search', coalesce(_search, ''),
    'status', _status,
    'direction', _direction,
    'page_size', 50,
    'has_more', has_more,
    'next_cursor', next_cursor,
    'rows', page_rows
  );
end;
$$;

revoke all on function finance_private.legacy_reconciliation_rows(
  uuid, uuid, date, date, text, text, text, text, text, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.list_finance_legacy_reconciliation_rows(
  _tenant_id uuid,
  _bank_account_id uuid,
  _period_start date,
  _period_end date,
  _kind text,
  _view text default 'all',
  _search text default '',
  _status text default 'all',
  _direction text default 'all',
  _cursor jsonb default null
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select finance_private.legacy_reconciliation_rows(
    _tenant_id, _bank_account_id, _period_start, _period_end,
    _kind, _view, _search, _status, _direction, _cursor
  );
$$;

revoke all on function public.list_finance_legacy_reconciliation_rows(
  uuid, uuid, date, date, text, text, text, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.list_finance_legacy_reconciliation_rows(
  uuid, uuid, date, date, text, text, text, text, text, jsonb
), finance_private.legacy_reconciliation_rows(
  uuid, uuid, date, date, text, text, text, text, text, jsonb
) to authenticated;


-- Source contract: 20260921140000_keyset_expense_review_list.sql
create or replace function public.list_driver_expenses_for_review_v2(
  _tenant_id uuid,
  _status text default 'pending',
  _cursor_expense_at timestamptz default null,
  _cursor_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_rows jsonb;
  v_count bigint;
  v_has_more boolean;
  v_next_cursor jsonb;
begin
  perform finance_private.require_access(_tenant_id);
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'expense_not_authorized' using errcode='42501';
  end if;
  if _status is null or _status not in('pending','reviewed')
     or (_cursor_expense_at is null) <> (_cursor_id is null) then
    raise exception 'expense_invalid_filter' using errcode='22023';
  end if;

  select count(*) into v_count
  from public.driver_expenses expense
  where expense.tenant_id=_tenant_id
    and (case when _status='pending' then expense.approval_status='pending' else expense.approval_status<>'pending' end);

  with candidates as materialized (
    select expense.id,expense.expense_at,
      to_jsonb(expense)||jsonb_build_object('driver_name',driver.name,'review_reason',review.reason) value
    from public.driver_expenses expense
    left join public.drivers driver on driver.tenant_id=expense.tenant_id and driver.id=expense.driver_id
    left join public.driver_expense_reviews review on review.tenant_id=expense.tenant_id and review.id=expense.review_command_id
    where expense.tenant_id=_tenant_id
      and (case when _status='pending' then expense.approval_status='pending' else expense.approval_status<>'pending' end)
      and (_cursor_expense_at is null or (expense.expense_at,expense.id)<(_cursor_expense_at,_cursor_id))
    order by expense.expense_at desc,expense.id desc
    limit 51
  ), page as (
    select * from candidates order by expense_at desc,id desc limit 50
  )
  select
    coalesce((select jsonb_agg(value order by expense_at desc,id desc) from page),'[]'::jsonb),
    (select count(*)>50 from candidates),
    case when (select count(*)>50 from candidates) then
      (select jsonb_build_object('expense_at',expense_at,'id',id) from page order by expense_at,id limit 1)
    else null end
  into v_rows,v_has_more,v_next_cursor;

  return jsonb_build_object(
    'version',2,'tenant_id',_tenant_id,'actor_id',auth.uid(),
    'can_review',public.is_tenant_admin(_tenant_id),'filter',_status,
    'cursor',case when _cursor_expense_at is null then null else jsonb_build_object('expense_at',_cursor_expense_at,'id',_cursor_id) end,
    'next_cursor',v_next_cursor,'has_more',v_has_more,'total',v_count,'rows',v_rows
  );
end;
$function$;

revoke all on function public.list_driver_expenses_for_review_v2(uuid,text,timestamptz,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.list_driver_expenses_for_review_v2(uuid,text,timestamptz,uuid)
to authenticated;


-- Source contract: 20260921140500_keyset_finance_fiscal_queue.sql
create or replace function finance_private.list_fiscal_queue_v2(
  _tenant uuid,
  _status text,
  _cursor_observed_order bigint default null,
  _cursor_observation_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  rows jsonb;
  total bigint;
  counts jsonb;
  scheduler_active boolean:=false;
  has_more boolean;
  next_cursor jsonb;
begin
  if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
  if _status is null or _status not in('','pending','review','applied','superseded')
     or (_cursor_observed_order is null) <> (_cursor_observation_id is null) then
    raise exception 'finance_invalid_fiscal_queue_filter' using errcode='22023';
  end if;

  select count(*) into total from public.finance_fiscal_projection_jobs
  where tenant_id=_tenant and (_status='' or status=_status);
  select jsonb_build_object('pending',count(*) filter(where status='pending'),'review',count(*) filter(where status='review'),
    'applied',count(*) filter(where status='applied'),'superseded',count(*) filter(where status='superseded')) into counts
  from public.finance_fiscal_projection_jobs where tenant_id=_tenant;

  with candidates as materialized (
    select o.observed_order,j.observation_id,jsonb_build_object(
      'observation_id',j.observation_id,'tenant_id',j.tenant_id,'status',j.status,
      'document_type',o.snapshot->>'doc_type','document_number',o.snapshot->>'number','fiscal_status',o.snapshot->>'status',
      'attempts',j.attempts,'automatic_failures',j.automatic_failures,'issue',j.issue,'available_at',j.available_at,
      'created_at',j.created_at,'updated_at',j.updated_at,'receivable_id',j.result->>'receivable_id') row_data
    from public.finance_fiscal_projection_jobs j
    join public.finance_fiscal_observations o on o.id=j.observation_id and o.tenant_id=j.tenant_id
    where j.tenant_id=_tenant and (_status='' or j.status=_status)
      and (_cursor_observed_order is null or (o.observed_order,j.observation_id)<(_cursor_observed_order,_cursor_observation_id))
    order by o.observed_order desc,j.observation_id desc limit 31
  ), page as (
    select * from candidates order by observed_order desc,observation_id desc limit 30
  )
  select coalesce((select jsonb_agg(row_data order by observed_order desc,observation_id desc) from page),'[]'::jsonb),
    (select count(*)>30 from candidates),
    case when (select count(*)>30 from candidates) then
      (select jsonb_build_object('observed_order',observed_order::text,'observation_id',observation_id)
       from page order by observed_order,observation_id limit 1)
    else null end
  into rows,has_more,next_cursor;

  if to_regclass('cron.job') is not null then
    execute $query$select exists(select 1 from cron.job where jobname='finance-fiscal-projection-every-minute' and active
      and command='SET statement_timeout = ''25s''; SELECT finance_private.run_fiscal_queue(50);')$query$ into scheduler_active;
  end if;
  return jsonb_build_object('version',2,'tenant_id',_tenant,'page_size',30,'status_filter',_status,'total',total,
    'cursor',case when _cursor_observed_order is null then null else jsonb_build_object('observed_order',_cursor_observed_order::text,'observation_id',_cursor_observation_id) end,
    'next_cursor',next_cursor,'has_more',has_more,'counts',counts,'scheduler_active',scheduler_active,'rows',rows);
end;$$;

revoke all on function finance_private.list_fiscal_queue_v2(uuid,text,bigint,uuid) from public,anon,authenticated,service_role;
create or replace function public.list_finance_fiscal_queue_v2(
  _tenant_id uuid,
  _status text default '',
  _cursor_observed_order bigint default null,
  _cursor_observation_id uuid default null
) returns jsonb
language sql stable security invoker set search_path='' as
$$select finance_private.list_fiscal_queue_v2(_tenant_id,_status,_cursor_observed_order,_cursor_observation_id);$$;
revoke all on function public.list_finance_fiscal_queue_v2(uuid,text,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_finance_fiscal_queue_v2(uuid,text,bigint,uuid),finance_private.list_fiscal_queue_v2(uuid,text,bigint,uuid) to authenticated;


-- Source contract: 20260921141000_page_finance_payroll_entries.sql
create or replace function finance_private.payroll_payment_projection_page(
  _tenant uuid,_period uuid,_page integer default 1,_search text default '',_payment text default 'all',_entry_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;period_state text;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page<1 or _page>1000000 or length(coalesce(_search,''))>200
    or _payment is null or _payment not in('all','unpaid','partial','paid','review','cancelled') then
  raise exception 'finance_invalid_payroll_entry_filter' using errcode='22023';
 end if;
 select status into period_state from public.payroll_periods where id=_period and tenant_id=_tenant;
 if not found then raise exception 'finance_payroll_period_not_found' using errcode='22023';end if;

 with entries as materialized (
  select e.*,jsonb_build_object('name',emp.name,'doc_cpf',emp.doc_cpf,'branch',emp.branch,'department',emp.department) employee,
    case when e.source_summary#>>'{payroll_carryover,amount_cents}' ~ '^\d{1,14}$'
      then (e.source_summary#>>'{payroll_carryover,amount_cents}')::numeric/100 else 0 end carryover_in
  from public.payroll_entries e left join public.employees emp on emp.id=e.employee_id and emp.tenant_id=e.tenant_id
  where e.tenant_id=_tenant and e.payroll_period_id=_period
 ),titles as materialized (
  select e.id,count(p.id) title_count,coalesce(sum(p.amount) filter(where p.status<>'cancelled'),0) title_amount,
    coalesce(bool_or(p.status='cancelled'),false) cancelled_title,coalesce(bool_or(p.category<>'payroll'),false) wrong_category
  from entries e left join public.payables p on p.tenant_id=_tenant and p.source_table='payroll_entries' and p.source_id=e.id group by e.id
 ),payments as materialized (
  select e.id,coalesce(sum(pp.amount),0) paid,coalesce(bool_or(pp.amount<=0 or pp.amount<>trunc(pp.amount,2)),false) invalid_amount
  from entries e left join public.payables p on p.tenant_id=_tenant and p.source_table='payroll_entries' and p.source_id=e.id
  left join finance_private.active_payable_payments pp on pp.payable_id=p.id and pp.tenant_id=_tenant group by e.id
 ),calculated as materialized (
  select e.*,t.title_count,py.paid,greatest(e.amount_to_pay-py.paid,0) remaining,array_remove(array[
    case when e.status in('approved','closed') and e.amount_to_pay>0 and t.title_count=0 then 'missing_title' end,
    case when t.title_count>1 then 'multiple_titles' end,case when t.title_count>0 and t.title_amount<>e.amount_to_pay then 'title_amount_mismatch' end,
    case when t.cancelled_title then 'cancelled_title' end,case when t.wrong_category then 'wrong_category' end,
    case when py.invalid_amount then 'invalid_payment_amount' end,case when py.paid>e.amount_to_pay then 'overpaid' end,
    case when (e.status='cancelled' or period_state='cancelled') and py.paid>0 then 'cancelled_entry_with_payment' end,
    case when e.status not in('approved','closed','cancelled') and t.title_count>0 then 'unexpected_title' end],null) issues
  from entries e join titles t using(id) join payments py using(id)
 ),presented as materialized (
  select c.*,case when cardinality(c.issues)>0 then 'review' when c.status='cancelled' then 'cancelled'
    when c.amount_to_pay=0 or c.paid=c.amount_to_pay then 'paid' when c.paid>0 or c.already_paid_amount>0 then 'partial' else 'unpaid' end projected_payment_status
  from calculated c
 ),filtered as materialized (
  select * from presented c where (_entry_id is null or c.id=_entry_id)
    and (_entry_id is not null or coalesce(_search,'')='' or concat_ws(' ',c.employee->>'name',c.employee_id::text,c.employee->>'department',c.employee->>'branch') ilike '%'||_search||'%')
    and (_payment='all' or c.projected_payment_status=_payment)
 ),page_rows as materialized (
  select * from filtered order by created_at,id limit 50 offset (_page-1)*50
 )
 select jsonb_build_object('version',2,'tenant_id',_tenant,'period_id',_period,'page',_page,'page_size',50,
  'search',coalesce(_search,''),'payment_filter',_payment,'total',(select count(*) from presented),
  'filtered_total',(select count(*) from filtered),'has_more',(_page*50<(select count(*) from filtered)),
  'totals',(select jsonb_build_object('gross',coalesce(sum(gross_amount),0)::text,'discount',coalesce(sum(discount_amount),0)::text,
    'already_paid',coalesce(sum(already_paid_amount),0)::text,'carryover_in',coalesce(sum(carryover_in),0)::text,
    'carryover_out',coalesce(sum(carryover_amount),0)::text,'title_paid',coalesce(sum(paid),0)::text,'remaining',coalesce(sum(remaining),0)::text) from presented),
  'rows',coalesce((select jsonb_agg((to_jsonb(c)-'employee'-'title_count'-'paid'-'remaining'-'issues'-'payment_status'-'projected_payment_status'-'carryover_in')||
    jsonb_build_object('employees',c.employee,'payment_summary',jsonb_build_object('obligation_amount',c.amount_to_pay::text,
      'paid_via_titles',c.paid::text,'remaining_amount',c.remaining::text,'overpaid_amount',greatest(c.paid-c.amount_to_pay,0)::text,
      'title_count',c.title_count,'issues',to_jsonb(c.issues),'status',c.projected_payment_status,'bank_confirmation','not_evaluated'))
    order by c.created_at,c.id) from page_rows c),'[]'::jsonb)) into result;
 return result;
end;$$;
revoke all on function finance_private.payroll_payment_projection_page(uuid,uuid,integer,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function finance_private.payroll_payment_projection_page(uuid,uuid,integer,text,text,uuid) to authenticated;

create or replace function public.get_finance_payroll_entry_page(_tenant_id uuid,_period_id uuid,_page integer default 1,_search text default '',_payment text default 'all',_entry_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as
$$select finance_private.payroll_payment_projection_page(_tenant_id,_period_id,_page,_search,_payment,_entry_id);$$;
revoke all on function public.get_finance_payroll_entry_page(uuid,uuid,integer,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_payroll_entry_page(uuid,uuid,integer,text,text,uuid) to authenticated;


-- Source contract: 20260921141500_keyset_finance_expenses.sql
create or replace function finance_private.list_expense_page_v2(_tenant uuid,_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare size integer:=coalesce((_filters->>'page_size')::integer,30);from_date date:=nullif(_filters->>'from','')::date;to_date date:=nullif(_filters->>'to','')::date;
 search text:=lower(coalesce(_filters->>'search',''));cursor_day date:=nullif(_filters->'cursor'->>'occurred_on','')::date;
 cursor_created timestamptz:=nullif(_filters->'cursor'->>'created_at','')::timestamptz;cursor_id uuid:=nullif(_filters->'cursor'->>'id','')::uuid;result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if jsonb_typeof(_filters) is distinct from 'object' or size not between 1 and 100 or length(search)>200 or from_date>to_date
  or exists(select 1 from jsonb_object_keys(_filters) k where k not in('page_size','from','to','search','category','context','trip_id','missing_receipt','cost_center','cursor'))
  or ((nullif(_filters->'cursor','null'::jsonb)) is not null and(cursor_day is null or cursor_created is null or cursor_id is null)) then
  raise exception 'finance_invalid_expense_filters' using errcode='22023';end if;
 with base as materialized(
  select e.*,x.id is not null cancelled,to_jsonb(x)-'source_snapshot' cancellation,b.context,b.trip_id,b.driver_id,b.description batch_description,c.name cost_center_name
  from public.finance_expense_items e
  left join public.finance_expense_cancellations x on x.tenant_id=e.tenant_id and x.expense_id=e.id
  join public.finance_expense_batches b on b.tenant_id=e.tenant_id and b.id=e.batch_id
  left join public.cost_centers c on c.id=e.cost_center_id and c.tenant_id=e.tenant_id
  where e.tenant_id=_tenant and(from_date is null or e.occurred_on>=from_date)and(to_date is null or e.occurred_on<=to_date)
   and(nullif(_filters->>'cost_center','')is null or((_filters->>'cost_center'='unassigned'and e.cost_center_id is null)or e.cost_center_id=nullif(nullif(_filters->>'cost_center',''),'unassigned')::uuid))
   and(nullif(_filters->>'category','')is null or e.category=_filters->>'category')and(nullif(_filters->>'context','')is null or b.context=_filters->>'context')
   and(nullif(_filters->>'trip_id','')is null or b.trip_id=(_filters->>'trip_id')::uuid)
   and(not coalesce((_filters->>'missing_receipt')::boolean,false)or(e.receipt_path is null and secure_upload_private.expense_receipt_count(e.tenant_id,e.id)=0))
   and position(search in lower(e.description||' '||e.supplier_name||' '||b.description||' '||coalesce(e.document_number,'')))>0
 ),candidates as materialized(
  select * from base e where cursor_day is null or e.occurred_on<cursor_day or(e.occurred_on=cursor_day and(e.created_at<cursor_created or(e.created_at=cursor_created and e.id<cursor_id)))
  order by occurred_on desc,created_at desc,id desc limit size+1
 ),scope as materialized(
  select * from candidates
 ),metrics as materialized(
  select s.*,finance_private.expense_cost_coverage(s.tenant_id,s.id) coverage,finance_private.expense_cost_effective(s.tenant_id,s.id) cost_origin,
   finance_private.effective_cost_amount(s.tenant_id,s.id) effective_amount_cents,secure_upload_private.expense_receipt_count(s.tenant_id,s.id) receipt_artifact_count,
   coalesce((select sum(a.amount_cents)from public.finance_expense_allocations a where a.tenant_id=s.tenant_id and a.expense_id=s.id),0)::bigint allocated_cents
  from scope s
 ),enriched as materialized(
  select m.*,(m.coverage->>'complement_cents')complement_cents,p.status payable_status,u.receivable_id,u.supplier_id reimbursement_supplier_id,
   u.source_snapshot->>'supplier_name'reimbursement_supplier_name,r.status receivable_status
  from metrics m left join public.payables p on p.id=m.payable_id and p.tenant_id=m.tenant_id
  left join public.finance_unloading_charges u on u.id=m.unloading_id and u.tenant_id=m.tenant_id
  left join public.receivables r on r.id=u.receivable_id and r.tenant_id=m.tenant_id
 ),page_source as materialized(
  select e.* from enriched e join(select id from candidates order by occurred_on desc,created_at desc,id desc limit size)c using(id)
 ),rows as materialized(
  select p.*,case when p.unloading_id is null then null else finance_private.unloading_effective_origin(p.tenant_id,p.unloading_id)end unloading_origin,
   coalesce((select jsonb_agg(jsonb_build_object('movement_id',m.id,'amount_cents',a.amount_cents,'movement_amount_cents',m.amount_cents,'beneficiary_name',m.beneficiary_name,'occurred_on',m.occurred_on,'bank_reference',m.bank_reference)order by m.occurred_on,m.id)
    from public.finance_expense_allocations a join public.finance_movements m on m.id=a.movement_id and m.tenant_id=a.tenant_id where a.expense_id=p.id and a.tenant_id=_tenant),'[]')allocations,
   coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'actor_id',v.actor_id,'actor_name',v.actor_name,'action',v.action,'reason',v.reason,'created_at',v.created_at)order by v.created_at,v.id)
    from public.finance_events v where v.tenant_id=_tenant and((v.entity_type='expense_batch'and v.entity_id=p.batch_id)or(v.entity_type='expense_item'and v.entity_id=p.id))),'[]')history
  from page_source p
 )
 select jsonb_build_object('version',2,'tenant_id',_tenant,'page_size',size,'cursor',_filters->'cursor','has_more',(select count(*)>size from candidates),
  'next_cursor',case when(select count(*)>size from candidates)then(select jsonb_build_object('occurred_on',occurred_on,'created_at',created_at,'id',id)from candidates order by occurred_on desc,created_at desc,id desc offset size-1 limit 1)end,
  'summary',null,
  'rows',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('effective_amount_cents',r.effective_amount_cents::text)order by occurred_on desc,created_at desc,id desc)from rows r),'[]'))into result;
 return result;
end$$;
revoke all on function finance_private.list_expense_page_v2(uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function finance_private.list_expense_page_v2(uuid,jsonb)to authenticated;
create or replace function public.list_finance_expense_page_v2(_tenant_id uuid,_filters jsonb default '{}')returns jsonb language sql stable security invoker set search_path=''as $$select finance_private.list_expense_page_v2(_tenant_id,_filters)$$;
revoke all on function public.list_finance_expense_page_v2(uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.list_finance_expense_page_v2(uuid,jsonb)to authenticated;


-- Source contract: 20260921170450_keyset_receivables_page.sql
create index if not exists finance_unloading_charges_receivable_lookup on public.finance_unloading_charges(tenant_id,receivable_id);
create index if not exists finance_fiscal_receivable_origins_receivable_lookup on public.finance_fiscal_receivable_origins(tenant_id,receivable_id);
create index if not exists receivables_tenant_created_keyset on public.receivables(tenant_id,created_at desc,id desc);

create or replace function finance_private.receivables_page_v3(_tenant uuid,_search text,_status text,_client uuid,_from date,_to date,_cursor jsonb,_origin text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;today date:=(statement_timestamp() at time zone 'America/Sao_Paulo')::date;
 cursor_created timestamptz:=nullif(_cursor->>'created_at','')::timestamptz;cursor_id uuid:=nullif(_cursor->>'id','')::uuid;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _origin is null or _origin not in('all','unloading','fiscal','other')or _search is null or length(_search)>200
  or _status is null or _status not in('all','pending','invoiced','partial','received','cancelled','overdue')
  or(_from is not null and not isfinite(_from))or(_to is not null and not isfinite(_to))or _from>_to
  or(_cursor is not null and(jsonb_typeof(_cursor)is distinct from'object'or cursor_created is null or cursor_id is null or exists(select 1 from jsonb_object_keys(_cursor)k where k not in('created_at','id'))))
 then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 if _client is not null and not exists(select 1 from public.clients where tenant_id=_tenant and id=_client)then raise exception 'finance_client_not_found' using errcode='22023';end if;
 with base as materialized(
  select r.id,r.created_at from public.receivables r left join public.clients c on c.tenant_id=r.tenant_id and c.id=r.client_id
  where r.tenant_id=_tenant and(_client is null or r.client_id=_client)
   and(_status='all'or r.status=_status or(_status='overdue'and r.status in('pending','invoiced','partial')and isfinite(r.due_date)and r.due_date<today))
   and(_from is null or r.due_date>=_from)and(_to is null or r.due_date<=_to)
   and(_search=''or strpos(lower(concat_ws(' ',r.description,r.invoice_number,c.company_name)),lower(_search))>0)
 ),filtered_keys as materialized(
  select b.* from base b join public.receivables r on r.tenant_id=_tenant and r.id=b.id
  where _origin='all'
   or(_origin='unloading'and exists(select 1 from public.finance_unloading_charges u where u.tenant_id=_tenant and u.receivable_id=r.id))
   or(_origin='fiscal'and not exists(select 1 from public.finance_unloading_charges u where u.tenant_id=_tenant and u.receivable_id=r.id)and(r.cte_document_id is not null or exists(select 1 from public.finance_fiscal_receivable_origins f where f.tenant_id=_tenant and f.receivable_id=r.id)))
   or(_origin='other'and not exists(select 1 from public.finance_unloading_charges u where u.tenant_id=_tenant and u.receivable_id=r.id)and r.cte_document_id is null and not exists(select 1 from public.finance_fiscal_receivable_origins f where f.tenant_id=_tenant and f.receivable_id=r.id))
 ),page_keys as materialized(
  select * from filtered_keys k where _cursor is null or k.created_at<cursor_created or(k.created_at=cursor_created and k.id<cursor_id)
  order by created_at desc,id desc limit 51
 ),rows as(
  select r.*,case when u.receivable_id is not null then'unloading'when r.cte_document_id is not null or f.receivable_id is not null then'fiscal'else'other'end origin_kind,
   case when c.id is not null then jsonb_build_object('company_name',c.company_name)end clients
  from(select * from page_keys order by created_at desc,id desc limit 50)k join public.receivables r on r.tenant_id=_tenant and r.id=k.id
  left join public.clients c on c.tenant_id=r.tenant_id and c.id=r.client_id
  left join lateral(select u.receivable_id from public.finance_unloading_charges u where u.tenant_id=_tenant and u.receivable_id=r.id limit 1)u on true
  left join lateral(select f.receivable_id from public.finance_fiscal_receivable_origins f where f.tenant_id=_tenant and f.receivable_id=r.id limit 1)f on true
 )
 select jsonb_build_object('version',3,'origin_filter',_origin,'tenant_id',_tenant,'page_size',50,'cursor',_cursor,
  'next_cursor',case when(select count(*)>50 from page_keys)then(select jsonb_build_object('created_at',created_at,'id',id)from page_keys order by created_at desc,id desc offset 49 limit 1)end,
  'has_more',(select count(*)>50 from page_keys),'total',(select count(*)from filtered_keys),'total_unfiltered',(select count(*)from public.receivables where tenant_id=_tenant),
  'rows',coalesce((select jsonb_agg(to_jsonb(p)order by p.created_at desc,p.id desc)from rows p),'[]'))into result;
 return result;
end$$;
revoke all on function finance_private.receivables_page_v3(uuid,text,text,uuid,date,date,jsonb,text)from public,anon,authenticated,service_role;
grant execute on function finance_private.receivables_page_v3(uuid,text,text,uuid,date,date,jsonb,text)to authenticated;
create or replace function public.get_finance_receivables_page_v3(_tenant_id uuid,_search text default'',_status text default'all',_client_id uuid default null,_from date default null,_to date default null,_cursor jsonb default null,_origin text default'all')
returns jsonb language sql stable security invoker set search_path=''as $$select finance_private.receivables_page_v3(_tenant_id,_search,_status,_client_id,_from,_to,_cursor,_origin)$$;
revoke all on function public.get_finance_receivables_page_v3(uuid,text,text,uuid,date,date,jsonb,text)from public,anon,authenticated,service_role;
grant execute on function public.get_finance_receivables_page_v3(uuid,text,text,uuid,date,date,jsonb,text)to authenticated;


-- Source contract: 20260921171357_keyset_finance_statements.sql
create index if not exists finance_statement_imports_keyset on public.finance_statement_imports(tenant_id,created_at desc,id desc);
create index if not exists finance_statement_verifications_latest on public.finance_statement_verifications(tenant_id,import_id,created_at desc,id desc);
create index if not exists finance_statement_rows_import_classification on public.finance_statement_rows(tenant_id,import_id,classification);
create index if not exists finance_statement_identity_reviews_row on public.finance_statement_identity_reviews(tenant_id,row_id);
create index if not exists finance_statement_review_reversals_review on public.finance_statement_review_reversals(tenant_id,review_id);

create or replace function finance_private.list_statements_v2(_tenant uuid,_filters jsonb default'{}')returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare size integer:=coalesce((_filters->>'page_size')::integer,20);start_date date:=nullif(_filters->>'from','')::date;end_date date:=nullif(_filters->>'to','')::date;
 cursor_created timestamptz:=nullif(_filters->'cursor'->>'created_at','')::timestamptz;cursor_id uuid:=nullif(_filters->'cursor'->>'id','')::uuid;result jsonb;
begin
 if not finance_private.can_access(_tenant)then raise exception'finance_access_denied'using errcode='42501';end if;
 if jsonb_typeof(_filters)is distinct from'object'or size not between 1 and 50 or start_date>end_date or length(coalesce(_filters->>'search',''))>200
  or exists(select 1 from jsonb_object_keys(_filters)k where k not in('page_size','from','to','search','account_id','source_status','cursor'))
  or((nullif(_filters->'cursor','null'::jsonb))is not null and(cursor_created is null or cursor_id is null or exists(select 1 from jsonb_object_keys(nullif(_filters->'cursor','null'::jsonb))k where k not in('created_at','id'))))
 then raise exception'finance_invalid_statement_filters'using errcode='22023';end if;
 with latest_verification as materialized(
  select distinct on(v.import_id)v.import_id,v.outcome,v.report from public.finance_statement_verifications v where v.tenant_id=_tenant order by v.import_id,v.created_at desc,v.id desc
 ),filtered_keys as materialized(
  select i.id,i.created_at,coalesce(v.outcome,'pending')source_verification,v.report verification_report
  from public.finance_statement_imports i join public.bank_accounts a on a.id=i.bank_account_id and a.tenant_id=i.tenant_id left join latest_verification v on v.import_id=i.id
  where i.tenant_id=_tenant and(nullif(_filters->>'account_id','')is null or i.bank_account_id=(_filters->>'account_id')::uuid)
   and(start_date is null or i.period_end>=start_date)and(end_date is null or i.period_start<=end_date)
   and position(lower(coalesce(_filters->>'search',''))in lower(i.file_name||' '||a.name))>0
   and(nullif(_filters->>'source_status','')is null or coalesce(v.outcome,'pending')=_filters->>'source_status')
 ),page_keys as materialized(
  select * from filtered_keys k where cursor_created is null or k.created_at<cursor_created or(k.created_at=cursor_created and k.id<cursor_id)
  order by created_at desc,id desc limit size+1
 ),rows as(
  select i.id,i.tenant_id,i.bank_account_id,a.name account_name,i.file_name,i.file_hash,i.source_path,i.period_start,i.period_end,i.input_rows,i.created_at,
   k.source_verification,k.verification_report,coalesce(stats.counts,'{}')counts,coalesce(stats.identity_review_count,0)identity_review_count,coalesce(stats.manual_review_count,0)manual_review_count
  from(select * from page_keys order by created_at desc,id desc limit size)k join public.finance_statement_imports i on i.tenant_id=_tenant and i.id=k.id
  join public.bank_accounts a on a.tenant_id=i.tenant_id and a.id=i.bank_account_id
  left join lateral(
   select coalesce(jsonb_object_agg(s.classification,s.n),'{}')counts,coalesce(sum(s.unresolved),0)identity_review_count,
    coalesce(sum(s.reviewed),0)manual_review_count
   from(select sr.classification,count(*)n,
     count(*)filter(where sr.classification in('ambiguous','reference_conflict','repeated_reference')and not exists(select 1 from public.finance_statement_identity_reviews ir where ir.tenant_id=_tenant and ir.row_id=sr.id and not exists(select 1 from public.finance_statement_review_reversals rv where rv.tenant_id=_tenant and rv.review_id=ir.id)))unresolved,
     count(*)filter(where exists(select 1 from public.finance_statement_identity_reviews ir where ir.tenant_id=_tenant and ir.row_id=sr.id and not exists(select 1 from public.finance_statement_review_reversals rv where rv.tenant_id=_tenant and rv.review_id=ir.id)))reviewed
    from public.finance_statement_rows sr where sr.tenant_id=_tenant and sr.import_id=i.id group by sr.classification)s
  )stats on true
 )
 select jsonb_build_object('version',2,'tenant_id',_tenant,'page_size',size,'cursor',_filters->'cursor','total',(select count(*)from filtered_keys),
  'has_more',(select count(*)>size from page_keys),'next_cursor',case when(select count(*)>size from page_keys)then(select jsonb_build_object('created_at',created_at,'id',id)from page_keys order by created_at desc,id desc offset size-1 limit 1)end,
  'rows',coalesce((select jsonb_agg(to_jsonb(r)order by created_at desc,id desc)from rows r),'[]'))into result;
 return result;
end$$;
revoke all on function finance_private.list_statements_v2(uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function finance_private.list_statements_v2(uuid,jsonb)to authenticated;
create or replace function public.list_finance_statements_v2(_tenant_id uuid,_filters jsonb default'{}')returns jsonb language sql stable security invoker set search_path=''as $$select finance_private.list_statements_v2(_tenant_id,_filters)$$;
revoke all on function public.list_finance_statements_v2(uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.list_finance_statements_v2(uuid,jsonb)to authenticated;


-- Source contract: 20260921131000_derive_portal_financial_title_overdue_status.sql
create or replace function private.portal_read_financial_titles(
  _tenant_id uuid,
  _client_id uuid default null,
  _status text[] default null,
  _limit integer default 50,
  _offset integer default 0,
  _title_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_rows jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_url text;
  v_number text;
  v_today date := (statement_timestamp() at time zone 'America/Sao_Paulo')::date;
begin
  if v_actor_id is null or _tenant_id is null then
    raise sqlstate '42501' using message = 'not_authorized';
  end if;
  if _limit < 1 or _limit > 100 or _offset < 0 then
    raise sqlstate '22023' using message = 'invalid_pagination';
  end if;

  if _title_id is not null then
    select nullif(btrim(ci.pdf_url), ''), coalesce(ci.invoice_number, r.invoice_number, r.id::text)
    into v_url, v_number
    from public.receivables r
    left join public.client_invoices ci
      on ci.tenant_id = r.tenant_id
     and (ci.id = r.client_invoice_id or ci.receivable_id = r.id)
    where r.id = _title_id
      and r.tenant_id = _tenant_id
      and exists (
        select 1
        from public.client_portal_access cpa
        where cpa.tenant_id = r.tenant_id
          and cpa.user_id = v_actor_id
          and cpa.client_id = r.client_id
          and cpa.active = true
          and cpa.can_view_financial = true
          and cpa.can_download_documents = true
      )
    order by (ci.id = r.client_invoice_id) desc
    limit 1;

    if v_url is null or not (v_url ~* '^https://[^[:space:]/@]+(:[0-9]{1,5})?(/|$)') then
      raise sqlstate '22023' using message = 'file_not_available';
    end if;

    return jsonb_build_object(
      'context', jsonb_build_object('tenant_id', _tenant_id, 'actor_id', v_actor_id, 'title_id', _title_id),
      'source', 'url',
      'filename', 'titulo-' || regexp_replace(v_number, '[^A-Za-z0-9._-]', '-', 'g') || '.pdf',
      'url', v_url
    );
  end if;

  with candidates as materialized (
    select
      r.id,
      r.client_id,
      c.company_name as client_name,
      r.fiscal_document_id,
      r.load_id,
      r.description,
      coalesce(ci.invoice_number, r.invoice_number) as invoice_number,
      r.amount,
      coalesce(r.received_amount, 0) as received_amount,
      greatest(r.amount - coalesce(r.received_amount, 0), 0) as outstanding_amount,
      coalesce(ci.due_date, r.due_date) as due_date,
      case
        when r.status in ('pending', 'invoiced', 'partial')
         and isfinite(coalesce(ci.due_date, r.due_date))
         and coalesce(ci.due_date, r.due_date) < v_today
         and greatest(r.amount - coalesce(r.received_amount, 0), 0) > 0
        then 'overdue'
        else r.status
      end as status,
      r.received_at,
      r.client_invoice_id,
      ci.issue_date as billing_issue_date,
      ci.status as billing_status,
      coalesce(ci.total_amount, r.amount) as billing_total_amount,
      coalesce(nullif(btrim(ci.pdf_url), '') ~* '^https://[^[:space:]/@]+(:[0-9]{1,5})?(/|$)', false) as has_pdf,
      exists (
        select 1
        from public.client_portal_access download_access
        where download_access.tenant_id = r.tenant_id
          and download_access.user_id = v_actor_id
          and download_access.client_id = r.client_id
          and download_access.active = true
          and download_access.can_view_financial = true
          and download_access.can_download_documents = true
      ) as can_download
    from public.receivables r
    join public.clients c on c.id = r.client_id and c.tenant_id = r.tenant_id
    left join lateral (
      select invoice.*
      from public.client_invoices invoice
      where invoice.tenant_id = r.tenant_id
        and (invoice.id = r.client_invoice_id or invoice.receivable_id = r.id)
      order by (invoice.id = r.client_invoice_id) desc, invoice.created_at desc
      limit 1
    ) ci on true
    where r.tenant_id = _tenant_id
      and (_client_id is null or r.client_id = _client_id)
      and exists (
        select 1
        from public.client_portal_access cpa
        where cpa.tenant_id = r.tenant_id
          and cpa.user_id = v_actor_id
          and cpa.client_id = r.client_id
          and cpa.active = true
          and cpa.can_view_financial = true
      )
  ), scoped as materialized (
    select *
    from candidates
    where _status is null or status = any(_status)
  ), page as (
    select *
    from scoped
    order by due_date asc nulls last, id
    limit _limit offset _offset
  )
  select
    coalesce(jsonb_agg(to_jsonb(page) order by due_date asc nulls last, id), '[]'::jsonb),
    (select count(*)::integer from scoped)
  into v_rows, v_total
  from page;

  return jsonb_build_object(
    'context', jsonb_build_object('tenant_id', _tenant_id, 'actor_id', v_actor_id, 'client_id', _client_id),
    'rows', v_rows,
    'total', v_total
  );
end;
$function$;

comment on function private.portal_read_financial_titles(uuid, uuid, text[], integer, integer, uuid) is
  'Reads authorized portal financial titles and derives overdue status from local due date and outstanding balance.';


-- Source contract: 20260921204000_portal_financial_titles_revision.sql
create or replace function private.portal_financial_titles_revision(
  _tenant_id uuid,
  _client_id uuid default null,
  _status text[] default null
)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  with candidates as (
    select
      r.id,
      coalesce(ci.due_date, r.due_date) as due_date,
      case
        when r.status in ('pending', 'invoiced', 'partial')
         and isfinite(coalesce(ci.due_date, r.due_date))
         and coalesce(ci.due_date, r.due_date) < (statement_timestamp() at time zone 'America/Sao_Paulo')::date
         and greatest(r.amount - coalesce(r.received_amount, 0), 0) > 0
        then 'overdue'
        else r.status
      end as effective_status
    from public.receivables r
    left join lateral (
      select invoice.due_date
      from public.client_invoices invoice
      where invoice.tenant_id = r.tenant_id
        and (invoice.id = r.client_invoice_id or invoice.receivable_id = r.id)
      order by (invoice.id = r.client_invoice_id) desc, invoice.created_at desc
      limit 1
    ) ci on true
    where r.tenant_id = _tenant_id
      and (_client_id is null or r.client_id = _client_id)
      and exists (
        select 1
        from public.client_portal_access cpa
        where cpa.tenant_id = r.tenant_id
          and cpa.user_id = auth.uid()
          and cpa.client_id = r.client_id
          and cpa.active = true
          and cpa.can_view_financial = true
      )
  )
  select md5(coalesce(string_agg(
    id::text || ':' || coalesce(due_date::text, '') || ':' || effective_status,
    '|' order by due_date asc nulls last, id
  ) filter (where _status is null or effective_status = any(_status)), ''))
  from candidates;
$function$;

revoke all privileges on function private.portal_financial_titles_revision(uuid, uuid, text[])
  from public, anon, authenticated, service_role;
grant execute on function private.portal_financial_titles_revision(uuid, uuid, text[])
  to authenticated;

create or replace function public.portal_list_financial_titles_v2(
  _tenant_id uuid,
  _client_id uuid default null,
  _status text[] default null,
  _limit integer default 50,
  _offset integer default 0,
  _revision text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set row_security = on
as $function$
declare
  v_revision text;
  v_result jsonb;
begin
  v_revision := private.portal_financial_titles_revision(_tenant_id, _client_id, _status);

  if _revision is not null and _revision <> v_revision then
    raise sqlstate '40001' using message = 'financial_titles_revision_changed';
  end if;

  v_result := private.portal_read_financial_titles(
    _tenant_id,
    _client_id,
    _status,
    _limit,
    _offset,
    null
  );

  return v_result || jsonb_build_object('revision', v_revision);
end;
$function$;

revoke all privileges on function public.portal_list_financial_titles_v2(uuid, uuid, text[], integer, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.portal_list_financial_titles_v2(uuid, uuid, text[], integer, integer, text)
  to authenticated;

comment on function public.portal_list_financial_titles_v2(uuid, uuid, text[], integer, integer, text) is
  'Lists portal financial titles and rejects offset pagination when the ordered result-set revision changed.';


-- Source contract: 20260921114500_persist_payroll_approval_issues.sql
do $patch$
declare
  body text;
  old_guard text := $guard$  if exists(select 1 from public.payroll_generation_issues where payroll_period_id=_period_id and not resolved) then
    raise exception 'finance_payroll_unresolved_generation_issues' using errcode='23514';
  end if;$guard$;
  new_guard text := $guard$  if exists(select 1 from public.payroll_generation_issues where payroll_period_id=_period_id and not resolved) then
    -- Return normally so diagnostics inserted earlier in this transaction remain durable.
    return;
  end if;$guard$;
begin
  select pg_get_functiondef('public.approve_payroll_period(uuid)'::regprocedure) into body;
  if position(old_guard in body) = 0 and position(new_guard in body) = 0 then
    raise exception 'finance_payroll_approval_issue_guard_changed';
  end if;
  -- Keep the published void RPC unchanged: old clients still receive an error.
  -- The versioned entry point persists diagnostics and returns approved=false.
  body := replace(body, 'public.approve_payroll_period(', 'finance_private.approve_payroll_period_with_issues(');
  execute replace(body, old_guard, new_guard);
end;
$patch$;

create or replace function public.approve_payroll_period_v2(_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  p public.payroll_periods%rowtype;
  issue_count integer;
begin
  select * into p from public.payroll_periods where id = _period_id;
  if p.id is null or auth.uid() is null or not public.is_tenant_operator_or_admin(p.tenant_id) then
    raise exception 'finance_access_denied' using errcode = '42501';
  end if;
  perform finance_private.require_access(p.tenant_id);
  perform finance_private.approve_payroll_period_with_issues(_period_id);
  select count(*)::integer into issue_count
  from public.payroll_generation_issues
  where tenant_id = p.tenant_id and payroll_period_id = p.id and not resolved;
  select * into p from public.payroll_periods where id = _period_id;
  return jsonb_build_object(
    'version', 2,
    'period_id', p.id,
    'tenant_id', p.tenant_id,
    'approved', p.status = 'approved',
    'issue_count', issue_count
  );
end;
$function$;

revoke all on function public.approve_payroll_period_v2(uuid) from public, anon, authenticated, service_role;
grant execute on function public.approve_payroll_period_v2(uuid) to authenticated;

comment on function public.approve_payroll_period_v2(uuid) is
  'Approves a payroll period or commits blocking generation issues and returns approved=false.';

revoke all on function finance_private.approve_payroll_period_with_issues(uuid) from public,anon,authenticated,service_role;


-- Source contract: 20260921211000_idempotent_payroll_approve_close.sql
create or replace function public.approve_payroll_period_v3(_period_id uuid, _request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant uuid;
  v_hash text;
  v_stored finance_private.atomic_command_results%rowtype;
  v_result jsonb;
begin
  select tenant_id into v_tenant from public.payroll_periods where id = _period_id;
  if auth.uid() is null or v_tenant is null or not public.is_tenant_operator_or_admin(v_tenant) then
    raise exception 'finance_access_denied' using errcode = '42501';
  end if;
  perform finance_private.require_access(v_tenant);
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':finance', 0));
  perform finance_private.require_access(v_tenant);
  if _request_id is null then raise exception 'request_id_required' using errcode = '22023'; end if;
  v_hash := md5(jsonb_build_object('period_id', _period_id)::text);
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':payroll-approve:' || _request_id::text, 0));
  select * into v_stored from finance_private.atomic_command_results
  where tenant_id = v_tenant and action = 'approve_payroll_period' and request_id = _request_id;
  if found then
    if v_stored.actor_id is distinct from auth.uid() then raise exception 'finance_request_actor_mismatch' using errcode='42501'; end if;
    if v_stored.payload_hash is distinct from v_hash then raise exception 'request_payload_mismatch' using errcode = '22023'; end if;
    return v_stored.result;
  end if;
  v_result := public.approve_payroll_period_v2(_period_id);
  insert into finance_private.atomic_command_results(tenant_id,action,request_id,payload_hash,result,actor_id,created_at)
  values (v_tenant, 'approve_payroll_period', _request_id, v_hash, v_result, auth.uid(), now());
  return v_result;
end;
$function$;

create or replace function public.close_payroll_period_v2(_period_id uuid, _reason text, _request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant uuid;
  v_hash text;
  v_stored finance_private.atomic_command_results%rowtype;
  v_result jsonb;
begin
  select tenant_id into v_tenant from public.payroll_periods where id = _period_id;
  if auth.uid() is null or v_tenant is null or not public.is_tenant_operator_or_admin(v_tenant) then
    raise exception 'finance_access_denied' using errcode = '42501';
  end if;
  perform finance_private.require_access(v_tenant);
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':finance', 0));
  perform finance_private.require_access(v_tenant);
  if not coalesce(public.is_tenant_admin(v_tenant),false) then raise exception 'finance_access_denied' using errcode='42501'; end if;
  if _request_id is null then raise exception 'request_id_required' using errcode = '22023'; end if;
  v_hash := md5(jsonb_build_object('period_id', _period_id, 'reason', coalesce(btrim(_reason), ''))::text);
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':payroll-close:' || _request_id::text, 0));
  select * into v_stored from finance_private.atomic_command_results
  where tenant_id = v_tenant and action = 'close_payroll_period' and request_id = _request_id;
  if found then
    if v_stored.actor_id is distinct from auth.uid() then raise exception 'finance_request_actor_mismatch' using errcode='42501'; end if;
    if v_stored.payload_hash is distinct from v_hash then raise exception 'request_payload_mismatch' using errcode = '22023'; end if;
    return v_stored.result;
  end if;
  perform public.close_payroll_period(_period_id, _reason);
  v_result := jsonb_build_object('closed', true, 'period_id', _period_id, 'request_id', _request_id);
  insert into finance_private.atomic_command_results(tenant_id,action,request_id,payload_hash,result,actor_id,created_at)
  values (v_tenant, 'close_payroll_period', _request_id, v_hash, v_result, auth.uid(), now());
  return v_result;
end;
$function$;

revoke all on function public.approve_payroll_period_v3(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.approve_payroll_period_v3(uuid, uuid) to authenticated;
revoke all on function public.close_payroll_period_v2(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.close_payroll_period_v2(uuid, text, uuid) to authenticated;


-- Source contract: 20260922035000_idempotent_statement_account_reassignment.sql
create or replace function public.reassign_finance_statement_account_v1(
  _tenant_id uuid,_import_id uuid,_account_id uuid,_reason text,_request_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  statement_import public.finance_statement_imports%rowtype;old_account uuid;entry_ids uuid[];actor_name text;
  request_hash text;request_key text;cached public.idempotency_keys%rowtype;result jsonb;
begin
  perform finance_private.require_access(_tenant_id);
  if _request_id is null or length(btrim(coalesce(_reason,'')))<10 then
    raise exception 'invalid_statement_account_reassignment' using errcode='22023';
  end if;
  request_hash:=encode(sha256(convert_to(jsonb_build_object(
    'import_id',_import_id,'account_id',_account_id,'reason',btrim(_reason)
  )::text,'UTF8')),'hex');
  request_key:='statement_account_reassign:'||auth.uid()::text||':'||_request_id::text;
  perform pg_advisory_xact_lock(hashtextextended(_tenant_id::text||':finance',0));
  select * into cached from public.idempotency_keys
  where tenant_id=_tenant_id and public.idempotency_keys.key_value=request_key;
  if found then
    if cached.operation is distinct from 'statement_account_reassign'
       or cached.payload_hash is distinct from request_hash then
      raise exception 'statement_account_reassignment_idempotency_mismatch' using errcode='22023';
    end if;
    if cached.response_body is null or cached.response_body->>'request_id' is distinct from _request_id::text then
      raise exception 'statement_account_reassignment_replay_invalid' using errcode='23514';
    end if;
    return cached.response_body;
  end if;

  select * into statement_import from public.finance_statement_imports
  where tenant_id=_tenant_id and id=_import_id for update;
  if not found then raise exception 'statement_not_found';end if;
  old_account:=statement_import.bank_account_id;
  if old_account=_account_id then
    raise exception 'statement_account_unchanged' using errcode='22023';
  end if;
  if not exists(select 1 from public.bank_accounts
    where tenant_id=_tenant_id and id=_account_id and active and account_type<>'cash') then
    raise exception 'invalid_target_account';
  end if;
  select array_agg(id) into entry_ids from public.finance_bank_entries
  where tenant_id=_tenant_id and first_import_id=_import_id;
  if exists(select 1 from public.finance_reconciliation_groups
    where tenant_id=_tenant_id and bank_entry_ids&&coalesce(entry_ids,'{}'::uuid[])) then
    raise exception 'statement_already_reconciled';
  end if;
  if exists(select 1 from public.finance_statement_identity_reviews review
    join public.finance_statement_rows statement_row on statement_row.tenant_id=review.tenant_id and statement_row.id=review.row_id
    where statement_row.import_id=_import_id) then raise exception 'statement_identity_review_exists';end if;
  update public.finance_statement_imports set bank_account_id=_account_id
  where tenant_id=_tenant_id and id=_import_id;
  update public.finance_bank_entries set bank_account_id=_account_id
  where tenant_id=_tenant_id and first_import_id=_import_id;
  select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,auth.uid()::text)
  into actor_name from auth.users where id=auth.uid();
  insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
  values(_tenant_id,'statement_import',_import_id,'statement_account_reassigned',auth.uid(),
    coalesce(actor_name,auth.uid()::text),btrim(_reason),jsonb_build_object('bank_account_id',old_account),
    jsonb_build_object('bank_account_id',_account_id,'manual_intervention',true,'request_id',_request_id));
  result:=jsonb_build_object('confirmed',true,'import_id',_import_id,'bank_account_id',_account_id,'request_id',_request_id);
  insert into public.idempotency_keys(tenant_id,key_value,operation,idempotency_key,payload_hash,result_id,response_body)
  values(_tenant_id,request_key,'statement_account_reassign',_request_id::text,request_hash,_import_id,result);
  return result;
end;
$function$;

revoke all on function public.reassign_finance_statement_account_v1(uuid,uuid,uuid,text,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.reassign_finance_statement_account_v1(uuid,uuid,uuid,text,uuid) to authenticated;
-- Keep the four-argument RPC available during the frontend rollout.
grant execute on function public.reassign_finance_statement_account_v1(uuid,uuid,uuid,text) to authenticated;


-- Source contract: 20260922046000_snapshot_available_settlement_loads.sql
drop function if exists public.list_available_loads_for_settlement_v2(uuid,uuid,text,uuid,integer,integer);

create or replace function public.list_available_loads_for_settlement_v2(
  _tenant_id uuid,
  _driver_id uuid default null,
  _search text default null,
  _include_settlement_id uuid default null,
  _page integer default 1,
  _page_size integer default 100,
  _expected_revision text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_page integer := greatest(coalesce(_page,1),1);
  v_size integer := greatest(1,least(coalesce(_page_size,100),200));
  v_total bigint;
  v_revision text;
  v_rows jsonb;
begin
  perform finance_private.require_access(_tenant_id);
  if not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'permission_denied' using errcode='42501';
  end if;

  with eligible as (
    select l.id,l.load_date,l.created_at
    from public.loads l
    where l.tenant_id=_tenant_id
      and l.driver_id is not null
      and (_driver_id is null or l.driver_id=_driver_id)
      and (nullif(btrim(_search),'') is null or l.load_number ilike '%'||_search||'%' or l.origin ilike '%'||_search||'%' or l.destination ilike '%'||_search||'%' or l.external_load_number ilike '%'||_search||'%')
      and public._load_available_for_settlement(_tenant_id,l.id,_include_settlement_id)
  )
  select count(*), md5(coalesce(string_agg(
    concat_ws(':',id::text,coalesce(load_date::text,''),created_at::text),
    '|' order by load_date desc nulls last,created_at desc,id
  ),''))
  into v_total,v_revision
  from eligible;

  if _expected_revision is not null and _expected_revision is distinct from v_revision then
    raise exception 'settlement_snapshot_changed' using errcode='40001';
  end if;

  with eligible as (
    select l.id,l.load_number,l.origin,l.destination,l.status,l.total_weight_kg,l.total_pallet_count,l.gross_cargo_value,l.freight_amount,
      l.invoice_count,l.load_date,l.driver_id,d.name driver_name,v.plate vehicle_plate,l.created_at
    from public.loads l
    left join public.drivers d on d.id=l.driver_id
    left join public.vehicles v on v.id=l.vehicle_id
    where l.tenant_id=_tenant_id
      and l.driver_id is not null
      and (_driver_id is null or l.driver_id=_driver_id)
      and (nullif(btrim(_search),'') is null or l.load_number ilike '%'||_search||'%' or l.origin ilike '%'||_search||'%' or l.destination ilike '%'||_search||'%' or l.external_load_number ilike '%'||_search||'%')
      and public._load_available_for_settlement(_tenant_id,l.id,_include_settlement_id)
  )
  select coalesce(jsonb_agg(to_jsonb(x)-'created_at'),'[]'::jsonb)
  into v_rows
  from (
    select * from eligible
    order by load_date desc nulls last,created_at desc,id
    limit v_size offset (v_page-1)*v_size
  ) x;

  return jsonb_build_object(
    'rows',v_rows,
    'total',v_total,
    'page',v_page,
    'page_size',v_size,
    'revision',v_revision
  );
end;
$function$;

revoke all on function public.list_available_loads_for_settlement_v2(uuid,uuid,text,uuid,integer,integer,text) from public,anon;
grant execute on function public.list_available_loads_for_settlement_v2(uuid,uuid,text,uuid,integer,integer,text) to authenticated,service_role;


-- Source contract: 20260922047000_snapshot_settlement_expense_context.sql
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

  with source_rows as materialized(
    select finance_private.expense_cost_coverage(e.tenant_id,e.id) coverage,e.id,e.batch_id,e.category,e.description,e.occurred_on,finance_private.effective_cost_amount(e.tenant_id,e.id) amount_cents,finance_private.expense_cost_effective(e.tenant_id,e.id) cost_origin,
      coalesce(a.cents,0) allocated,e.payable_id,p.id title_id,p.status payable_status,p.supplier_name payee_name,p.amount title_amount,
      p.source_table,p.source_id,b.driver_id,
      trunc(coalesce(paid.amount,0)*100) paid,coalesce(paid.amount,0)*100<>trunc(coalesce(paid.amount,0)*100) paid_invalid,origin.payee_type original_payee,
      (finance_private.expense_cost_coverage(e.tenant_id,e.id)->>'complement_cents')::numeric complement
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

create or replace function public.get_finance_settlement_expense_context_v2(
  _tenant_id uuid,
  _settlement_id uuid,
  _page integer default 1,
  _expected_revision text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$select finance_private.settlement_expense_context_v2(_tenant_id,_settlement_id,_page,_expected_revision)$$;

revoke all on function public.get_finance_settlement_expense_context_v2(uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_settlement_expense_context_v2(uuid,uuid,integer,text) to authenticated;


-- Source contract: 20260922203000_snapshot_payable_movement_options.sql
drop function if exists public.get_finance_payable_movements(uuid,uuid,text,integer);
drop function if exists finance_private.payable_movement_options(uuid,uuid,text,integer);

create or replace function finance_private.payable_movement_options(_tenant uuid,_payable uuid,_search text default '',_page integer default 1,_expected_revision text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.payables%rowtype;result jsonb;paid numeric;page_revision text;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page not between 1 and 1000000 or length(coalesce(_search,''))>200
  or (_expected_revision is not null and _expected_revision!~'^[a-f0-9]{32}$') then raise exception 'finance_invalid_options' using errcode='22023';end if;
 select * into p from public.payables where id=_payable and tenant_id=_tenant;
 if not found then raise exception 'finance_payable_not_found' using errcode='22023';end if;
 select coalesce(sum(amount),0) into paid from finance_private.active_payable_payments where tenant_id=_tenant and payable_id=_payable;
 with capacity as materialized(
  select m.id,m.beneficiary_name,m.description,m.occurred_on,m.bank_reference,m.bank_account_id,b.name account_name,m.amount_cents,
   m.amount_cents-finance_private.movement_used_cents(_tenant,m.id) remaining_cents
  from finance_private.active_movements m join public.bank_accounts b on b.id=m.bank_account_id and b.tenant_id=_tenant
  where m.tenant_id=_tenant and m.direction='out' and m.nature<>'transfer'
   and (p.driver_id is null or m.driver_id=p.driver_id)
   and position(lower(coalesce(_search,'')) in lower(m.beneficiary_name||' '||m.description||' '||coalesce(m.bank_reference,'')||' '||b.name||' '||m.id::text))>0
 ),candidates as materialized(
  select id,beneficiary_name,description,occurred_on,bank_reference,bank_account_id,account_name,amount_cents::text amount_cents,remaining_cents::text remaining_cents
  from capacity where remaining_cents>0
 ),revision as(
  select md5(coalesce(jsonb_agg(to_jsonb(c) order by occurred_on desc,id)::text,'[]')) value from candidates c
 ),paged as(select * from candidates order by occurred_on desc,id limit 30 offset (_page-1)*30)
 select r.value,jsonb_build_object('version',1,'tenant_id',_tenant,'payable_id',_payable,'page_revision',r.value,'page',_page,'total',(select count(*) from candidates),
  'payable_status',p.status,'payable_name',p.supplier_name,'remaining_cents',(greatest(p.amount-paid,0)*100)::numeric(30,0)::text,
  'can_apply',p.status in('approved','partial') and paid>=0 and paid=trunc(paid,2) and p.amount>paid,
  'rows',coalesce((select jsonb_agg(to_jsonb(row) order by row.occurred_on desc,row.id) from paged row),'[]'))
 into page_revision,result from revision r;
 if _expected_revision is not null and _expected_revision is distinct from page_revision then raise exception 'finance_payable_options_changed' using errcode='40001';end if;
 return result;
end$$;
revoke all on function finance_private.payable_movement_options(uuid,uuid,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.payable_movement_options(uuid,uuid,text,integer,text) to authenticated;

create or replace function public.get_finance_payable_movements(_tenant_id uuid,_payable_id uuid,_search text default '',_page integer default 1,_expected_revision text default null)
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.payable_movement_options(_tenant_id,_payable_id,_search,_page,_expected_revision);$$;
revoke all on function public.get_finance_payable_movements(uuid,uuid,text,integer,text) from public,anon,service_role;
grant execute on function public.get_finance_payable_movements(uuid,uuid,text,integer,text) to authenticated;


-- Source contract: 20260922204000_snapshot_payable_payment_history.sql
drop function if exists public.get_finance_payable_payment_history(uuid,uuid,integer);
drop function if exists finance_private.payable_payment_history(uuid,uuid,integer);

create or replace function finance_private.payable_payment_history(_tenant uuid,_payable uuid,_page integer default 1,_expected_revision text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;page_revision text;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page not between 1 and 1000000 or (_expected_revision is not null and _expected_revision!~'^[a-f0-9]{32}$') then raise exception 'finance_invalid_page' using errcode='22023';end if;
 if not exists(select 1 from public.payables where tenant_id=_tenant and id=_payable) then raise exception 'finance_payable_not_found' using errcode='22023';end if;
 with payments as materialized(
  select p.*,b.name account_name,l.id link_id,l.movement_id,l.origin link_origin,
   case when r.id is null then null else jsonb_build_object('id',r.id,'actor_id',r.created_by,'actor_name',r.actor_name,'reason',r.reason,'created_at',r.created_at) end reversal
  from public.payables_payments p left join public.bank_accounts b on b.id=p.bank_account_id and b.tenant_id=_tenant
  left join lateral(select l.* from public.finance_payable_movement_links l where l.payment_id=p.id and l.tenant_id=_tenant
   order by exists(select 1 from public.finance_payable_link_reversals rv where rv.tenant_id=l.tenant_id and rv.link_id=l.id),l.created_at desc,l.id desc limit 1) l on true
  left join public.finance_payable_link_reversals r on r.link_id=l.id and r.tenant_id=_tenant
  where p.tenant_id=_tenant and p.payable_id=_payable
 ),revision as(select md5(coalesce(jsonb_agg(to_jsonb(p) order by paid_at desc,id desc)::text,'[]')) value from payments p),
 paged as(select * from payments order by paid_at desc,id desc limit 30 offset (_page-1)*30)
 select r.value,jsonb_build_object('version',1,'tenant_id',_tenant,'payable_id',_payable,'page_revision',r.value,'page',_page,'total',(select count(*) from payments),
  'rows',coalesce((select jsonb_agg(to_jsonb(p) order by p.paid_at desc,p.id desc) from paged p),'[]')) into page_revision,result from revision r;
 if _expected_revision is not null and _expected_revision is distinct from page_revision then raise exception 'finance_payable_history_changed' using errcode='40001';end if;
 return result;
end$$;
revoke all on function finance_private.payable_payment_history(uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.payable_payment_history(uuid,uuid,integer,text) to authenticated;

create or replace function public.get_finance_payable_payment_history(_tenant_id uuid,_payable_id uuid,_page integer default 1,_expected_revision text default null)
returns jsonb language sql security invoker set search_path='' as $$select finance_private.payable_payment_history(_tenant_id,_payable_id,_page,_expected_revision);$$;
revoke all on function public.get_finance_payable_payment_history(uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_payable_payment_history(uuid,uuid,integer,text) to authenticated;

notify pgrst, 'reload schema';
