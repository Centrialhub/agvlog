-- Local database-only command. It records bookkeeping evidence but never emits
-- fiscal documents or initiates a bank transfer.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $guard$
begin
  if to_regprocedure('public.apply_receivable_financial_command(jsonb)') is null
     or to_regclass('private.load_payment_commands') is not null then
    raise exception 'Load payments require the canonical receivable command and an unapplied migration';
  end if;
end;
$guard$;

create schema if not exists private;

create table private.load_payment_commands (
  id uuid primary key,
  tenant_id uuid not null,
  actor_id uuid not null,
  request_id uuid not null,
  load_id uuid not null,
  receivable_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  financial_command_id uuid not null,
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, id),
  unique (tenant_id, actor_id, request_id),
  foreign key (tenant_id, load_id)
    references public.loads (tenant_id, id) on delete restrict,
  foreign key (tenant_id, receivable_id)
    references public.receivables (tenant_id, id) on delete restrict,
  foreign key (tenant_id, financial_command_id)
    references public.receivable_financial_commands (tenant_id, id) on delete restrict
);

create index load_payment_commands_target_idx
  on private.load_payment_commands (tenant_id, load_id, created_at desc);
create index load_payment_commands_receivable_idx
  on private.load_payment_commands (tenant_id, receivable_id);
create unique index load_payment_commands_financial_command_key
  on private.load_payment_commands (tenant_id, financial_command_id);

alter table private.load_payment_commands enable row level security;
revoke all on table private.load_payment_commands from public, anon, authenticated, service_role;

create function private.preserve_load_payment_command()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  raise exception 'load_payment_command_is_immutable' using errcode = '55000';
end;
$fn$;

revoke all on function private.preserve_load_payment_command()
  from public, anon, authenticated, service_role;

create trigger load_payment_commands_append_only
before update or delete on private.load_payment_commands
for each row execute function private.preserve_load_payment_command();

create unique index if not exists load_payment_tenant_id_key
  on public.load_payments (tenant_id, id);

alter table public.load_payments
  add column load_payment_command_id uuid,
  add column receivable_payment_id uuid,
  add column bank_transaction_id uuid,
  add constraint load_payment_amount_positive
    check (amount > 0) not valid,
  add constraint load_payment_load_tenant_fkey
    foreign key (tenant_id, load_id)
    references public.loads (tenant_id, id)
    on delete cascade not valid,
  add constraint load_payment_receivable_tenant_fkey
    foreign key (tenant_id, receivable_id)
    references public.receivables (tenant_id, id)
    on delete restrict not valid,
  add constraint load_payment_bank_account_tenant_fkey
    foreign key (tenant_id, bank_account_id)
    references public.bank_accounts (tenant_id, id)
    on delete restrict not valid,
  add constraint load_payment_receivable_payment_tenant_fkey
    foreign key (tenant_id, receivable_payment_id)
    references public.receivables_payments (tenant_id, id)
    on delete restrict not valid,
  add constraint load_payment_bank_transaction_tenant_fkey
    foreign key (tenant_id, bank_transaction_id)
    references public.bank_transactions (tenant_id, id)
    on delete restrict not valid,
  add constraint load_payment_command_tenant_fkey
    foreign key (tenant_id, load_payment_command_id)
    references private.load_payment_commands (tenant_id, id)
    deferrable initially deferred;

create unique index load_payment_one_row_per_command
  on public.load_payments (tenant_id, load_payment_command_id)
  where load_payment_command_id is not null;
create unique index load_payment_one_row_per_receivable_payment
  on public.load_payments (tenant_id, receivable_payment_id)
  where receivable_payment_id is not null;
create index load_payment_receivable_idx
  on public.load_payments (tenant_id, receivable_id);
create index load_payment_bank_account_idx
  on public.load_payments (tenant_id, bank_account_id)
  where bank_account_id is not null;
create unique index load_payment_one_row_per_bank_transaction
  on public.load_payments (tenant_id, bank_transaction_id)
  where bank_transaction_id is not null;

create index if not exists load_status_history_tenant_load_idx
  on public.load_status_history (tenant_id, load_id, created_at desc);

alter table public.load_status_history
  add constraint load_status_history_load_tenant_fkey
    foreign key (tenant_id, load_id)
    references public.loads (tenant_id, id)
    on delete cascade not valid;

create function private.guard_canonical_load_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    if new.load_payment_command_id is not null
       and (new.receivable_id is null or new.receivable_payment_id is null
            or new.bank_account_id is null or new.bank_transaction_id is null) then
      raise exception 'canonical_load_payment_evidence_required' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.load_payment_command_id is not null then
    raise exception 'canonical_load_payment_is_immutable' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$fn$;

revoke all on function private.guard_canonical_load_payment()
  from public, anon, authenticated, service_role;

create trigger guard_canonical_load_payment
before insert or update or delete on public.load_payments
for each row execute function private.guard_canonical_load_payment();

create function public.apply_load_payment_command(_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_request uuid;
  v_load_id uuid;
  v_receivable_id uuid;
  v_bank_account_id uuid;
  v_command_id uuid := gen_random_uuid();
  v_financial_request_id uuid;
  v_payload_hash text;
  v_amount_cents bigint;
  v_amount numeric(14,2);
  v_effective_date date;
  v_method text;
  v_notes text;
  v_reason text;
  v_previous private.load_payment_commands%rowtype;
  v_load public.loads%rowtype;
  v_receivable public.receivables%rowtype;
  v_financial_before jsonb;
  v_financial_result jsonb;
  v_receivable_payment_id uuid;
  v_bank_transaction_id uuid;
  v_financial_command_id uuid;
  v_load_payment_id uuid;
  v_received numeric(14,2);
  v_new_status text;
  v_new_version integer;
  v_response jsonb;
begin
  if jsonb_typeof(_payload) is distinct from 'object'
     or octet_length(_payload::text) > 20000
     or _payload->'version' is distinct from '1'::jsonb
     or exists (
       select 1 from jsonb_object_keys(_payload) key
       where key not in (
         'version', 'tenant_id', 'actor_id', 'request_id', 'load_id',
         'receivable_id', 'amount_cents', 'effective_date',
         'bank_account_id', 'method', 'notes'
       )
     ) then
    raise exception 'load_payment_invalid_command' using errcode = '22023';
  end if;

  begin
    v_tenant := (_payload->>'tenant_id')::uuid;
    v_request := (_payload->>'request_id')::uuid;
    v_load_id := (_payload->>'load_id')::uuid;
    v_receivable_id := (_payload->>'receivable_id')::uuid;
    v_bank_account_id := (_payload->>'bank_account_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'load_payment_invalid_command' using errcode = '22023';
  end;

  if v_actor is null
     or _payload->>'actor_id' is distinct from v_actor::text
     or v_tenant is null
     or not coalesce(public.is_tenant_operator_or_admin(v_tenant), false) then
    raise exception 'load_payment_not_authorized' using errcode = '42501';
  end if;

  if v_request is null or v_load_id is null or v_receivable_id is null
     or v_bank_account_id is null
     or jsonb_typeof(_payload->'amount_cents') is distinct from 'number'
     or (_payload->>'amount_cents') !~ '^[0-9]+$'
     or (_payload->>'amount_cents')::numeric not between 1 and 99999999999999
     or jsonb_typeof(_payload->'effective_date') is distinct from 'string'
     or (_payload->>'effective_date') !~ '^\d{4}-\d{2}-\d{2}$'
     or coalesce(_payload->>'method', '') not in
       ('pix', 'boleto', 'ted', 'doc', 'dinheiro', 'cartao', 'debito_automatico', 'other')
     or (jsonb_typeof(_payload->'notes') is not null
         and jsonb_typeof(_payload->'notes') not in ('string', 'null'))
     or length(_payload->>'notes') > 2000 then
    raise exception 'load_payment_invalid_command' using errcode = '22023';
  end if;

  begin
    v_amount_cents := (_payload->>'amount_cents')::bigint;
    v_effective_date := (_payload->>'effective_date')::date;
  exception when numeric_value_out_of_range or datetime_field_overflow then
    raise exception 'load_payment_invalid_command' using errcode = '22023';
  end;

  if not isfinite(v_effective_date)
     or v_effective_date > (clock_timestamp() at time zone 'America/Sao_Paulo')::date then
    raise exception 'load_payment_invalid_date' using errcode = '22023';
  end if;

  v_amount := v_amount_cents::numeric / 100;
  v_method := _payload->>'method';
  v_notes := nullif(btrim(_payload->>'notes'), '');
  v_payload_hash := encode(sha256(convert_to((_payload - 'request_id')::text, 'UTF8')), 'hex');
  v_financial_request_id := md5('load-payment:' || v_request::text)::uuid;

  perform pg_advisory_xact_lock(
    hashtext('load-payment-command'),
    hashtext(v_tenant::text || ':' || v_actor::text || ':' || v_request::text)
  );

  perform tenant_id
    from public.tenant_memberships
   where tenant_id = v_tenant
     and user_id = v_actor
     and active
     and role::text in ('owner', 'admin', 'operator')
   for share nowait;
  if not found then
    raise exception 'load_payment_not_authorized' using errcode = '42501';
  end if;

  select * into v_previous
    from private.load_payment_commands
   where tenant_id = v_tenant
     and actor_id = v_actor
     and request_id = v_request;
  if found then
    if v_previous.payload_hash <> v_payload_hash then
      raise exception 'load_payment_request_key_mismatch' using errcode = '22023';
    end if;
    return v_previous.response;
  end if;

  select * into v_load
    from public.loads
   where tenant_id = v_tenant and id = v_load_id
   for update nowait;
  if not found then
    raise exception 'load_payment_load_not_found' using errcode = '23514';
  end if;
  if v_load.receivable_id is null or v_load.receivable_id <> v_receivable_id then
    raise exception 'load_payment_invalid_receivable_link' using errcode = '23514';
  end if;
  if lower(coalesce(v_load.operational_status, '')) = 'cancelled'
     or lower(coalesce(v_load.status, '')) = 'cancelled'
     or lower(coalesce(v_load.payment_status, '')) = 'cancelled' then
    raise exception 'load_payment_cancelled_load' using errcode = '55000';
  end if;

  select * into v_receivable
    from public.receivables
   where tenant_id = v_tenant and id = v_receivable_id
   for update nowait;
  if not found or v_receivable.load_id is distinct from v_load_id then
    raise exception 'load_payment_invalid_receivable_link' using errcode = '23514';
  end if;
  if v_receivable.status = 'cancelled'
     or v_receivable.amount <= 0
     or v_load.freight_amount <= 0
     or round(v_receivable.amount, 2) <> round(v_load.freight_amount, 2)
     or round(coalesce(v_receivable.received_amount, 0), 2)
        <> round(coalesce(v_load.received_amount, 0), 2) then
    raise exception 'load_payment_requires_reconciliation' using errcode = '55000';
  end if;

  perform id
    from public.bank_accounts
   where tenant_id = v_tenant and id = v_bank_account_id and active
   for share nowait;
  if not found then
    raise exception 'load_payment_invalid_bank_account' using errcode = '23514';
  end if;

  v_financial_before := public._receivable_financial_snapshot(v_tenant, v_receivable_id);
  if coalesce((v_financial_before->>'requires_reconciliation')::boolean, true) then
    raise exception 'load_payment_requires_reconciliation' using errcode = '55000';
  end if;
  if v_amount_cents > (v_financial_before->>'open_cents')::bigint then
    raise exception 'load_payment_amount_exceeds_open_balance' using errcode = '22023';
  end if;

  v_reason := left('Pagamento da carga ' || coalesce(v_load.external_load_number, v_load.load_number), 2000);
  v_financial_result := public.apply_receivable_financial_command(jsonb_build_object(
    'version', 1,
    'tenant_id', v_tenant,
    'actor_id', v_actor,
    'request_id', v_financial_request_id,
    'receivable_id', v_receivable_id,
    'expected_revision', v_financial_before->>'revision',
    'action', 'receive',
    'reason', v_reason,
    'amount_cents', v_amount_cents,
    'effective_date', to_char(v_effective_date, 'YYYY-MM-DD'),
    'bank_account_id', v_bank_account_id,
    'method', v_method,
    'notes', v_notes,
    'attachment_path', null
  ));

  if v_financial_result->>'confirmed' is distinct from 'true'
     or (v_financial_result->>'receivable_id')::uuid <> v_receivable_id
     or (v_financial_result->>'request_id')::uuid <> v_financial_request_id then
    raise exception 'load_payment_financial_confirmation_invalid' using errcode = '55000';
  end if;

  v_receivable_payment_id := (v_financial_result->>'payment_id')::uuid;
  v_bank_transaction_id := (v_financial_result->>'bank_transaction_id')::uuid;
  v_financial_command_id := (v_financial_result->>'command_id')::uuid;
  v_received := (v_financial_result->>'received_cents')::numeric / 100;

  if v_receivable_payment_id is null or v_bank_transaction_id is null
     or v_financial_command_id is null then
    raise exception 'load_payment_financial_confirmation_invalid' using errcode = '55000';
  end if;

  insert into public.load_payments (
    tenant_id, load_id, receivable_id, payment_date, amount,
    payment_method, bank_account_id, notes, created_by,
    load_payment_command_id, receivable_payment_id, bank_transaction_id
  ) values (
    v_tenant, v_load_id, v_receivable_id, v_effective_date, v_amount,
    v_method, v_bank_account_id, v_notes, v_actor,
    v_command_id, v_receivable_payment_id, v_bank_transaction_id
  ) returning id into v_load_payment_id;

  v_new_status := case
    when v_received >= v_load.freight_amount then 'paid'
    when v_received > 0 then 'partially_paid'
    when v_load.expected_payment_date is not null
         and v_load.expected_payment_date < (clock_timestamp() at time zone 'America/Sao_Paulo')::date then 'overdue'
    else 'unpaid'
  end;

  update public.loads
     set received_amount = v_received,
         payment_status = v_new_status,
         payment_date = case when v_new_status = 'paid' then v_effective_date else null end,
         version = version + 1,
         updated_at = clock_timestamp()
   where tenant_id = v_tenant and id = v_load_id
   returning version into v_new_version;

  insert into public.load_status_history (
    tenant_id, load_id, field_name, old_value, new_value, reason, created_by
  ) values (
    v_tenant, v_load_id, 'received_amount',
    coalesce(v_load.received_amount, 0)::text, v_received::text,
    'Pagamento confirmado; request_id=' || v_request::text ||
      '; load_payment_id=' || v_load_payment_id::text,
    v_actor
  );

  if v_new_status is distinct from v_load.payment_status then
    insert into public.load_status_history (
      tenant_id, load_id, field_name, old_value, new_value, reason, created_by
    ) values (
      v_tenant, v_load_id, 'payment_status', v_load.payment_status, v_new_status,
      'Estado financeiro derivado do ledger; request_id=' || v_request::text,
      v_actor
    );
  end if;

  v_response := jsonb_build_object(
    'version', 1,
    'tenant_id', v_tenant,
    'actor_id', v_actor,
    'request_id', v_request,
    'load_id', v_load_id,
    'receivable_id', v_receivable_id,
    'confirmed', true,
    'command_id', v_command_id,
    'financial_command_id', v_financial_command_id,
    'load_payment_id', v_load_payment_id,
    'receivable_payment_id', v_receivable_payment_id,
    'bank_transaction_id', v_bank_transaction_id,
    'amount_cents', v_amount_cents,
    'received_cents', (v_financial_result->>'received_cents')::bigint,
    'open_cents', (v_financial_result->>'open_cents')::bigint,
    'payment_status', v_new_status,
    'load_version', v_new_version
  );

  insert into private.load_payment_commands (
    id, tenant_id, actor_id, request_id, load_id, receivable_id,
    payload_hash, financial_command_id, response
  ) values (
    v_command_id, v_tenant, v_actor, v_request, v_load_id, v_receivable_id,
    v_payload_hash, v_financial_command_id, v_response
  );

  return v_response;
exception
  when lock_not_available then
    raise exception 'load_payment_concurrent_change' using errcode = '40001';
end;
$fn$;

comment on function public.apply_load_payment_command(jsonb) is
  'Canonical, idempotent bookkeeping command for an already-received load payment. Does not transfer funds or issue fiscal documents.';

revoke all on function public.apply_load_payment_command(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_load_payment_command(jsonb) to authenticated;
