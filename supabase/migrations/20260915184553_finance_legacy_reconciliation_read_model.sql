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

create function finance_private.legacy_reconciliation_summary(
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

create function public.get_finance_legacy_reconciliation_summary(
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

create function finance_private.legacy_reconciliation_rows(
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

create function public.list_finance_legacy_reconciliation_rows(
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
