-- Keep privileged receivable-agreement logic private and expose invoker wrappers.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $preflight$
declare
  spec record;
  procedure_record record;
begin
  for spec in
    select * from (values
      ('public.get_finance_receivable_agreement_context(uuid,uuid,jsonb)', 'b19fa99024d172ca09d94bf86d38a6c0', 's'),
      ('public.record_finance_receivable_agreement(jsonb)', '9d952af63dd801fd8a79c3e853fffddc', 'v'),
      ('public.get_finance_receivable_installment_position(uuid,uuid)', '6f1478155194f78cca469111c5efd2ab', 's'),
      ('public.get_finance_receivable_agreement_history(uuid,uuid,integer,integer,text)', 'd6e6f42dd06cfeda18d61eb19ea775f5', 's'),
      ('public.get_finance_receivable_payment_installments(uuid,uuid,uuid,integer,integer,text)', '402072d29ec86f7ebda4d298ea0cab48', 's'),
      ('public.get_finance_closing_receivable_agreement(uuid,uuid)', '9a9272c59c2617acff05c78fa0d95cf2', 's')
    ) value(signature, body_md5, volatility)
  loop
    select * into procedure_record from pg_proc where oid = to_regprocedure(spec.signature);
    if procedure_record.oid is null
      or md5(procedure_record.prosrc) is distinct from spec.body_md5
      or not procedure_record.prosecdef
      or procedure_record.provolatile::text is distinct from spec.volatility
      or procedure_record.proconfig is distinct from array['search_path=""']::text[]
      or not has_function_privilege('authenticated', procedure_record.oid, 'execute')
      or has_function_privilege('anon', procedure_record.oid, 'execute')
      or has_function_privilege('service_role', procedure_record.oid, 'execute')
    then
      raise exception 'finance_receivable_agreement_public_predecessor_changed: %', spec.signature using errcode = '55000';
    end if;
  end loop;

  for spec in
    select * from (values
      ('finance_private.receivable_agreement_context(uuid,uuid,jsonb)', 'b5dc8a5c20cbaddc9f8352aa5cb75fb4', 's'),
      ('finance_private.record_receivable_agreement(jsonb)', 'e89f71df94454ff7a66a93d4f6232256', 'v'),
      ('finance_private.receivable_installment_position(uuid,uuid)', 'aa3c2f96b90809aa8f2b1a8dac39c265', 's'),
      ('finance_private.receivable_agreement_history(uuid,uuid,integer,integer,text)', '9e45bea2efdaaf8a63d2eea7cebe418b', 's'),
      ('finance_private.receivable_payment_installment_history(uuid,uuid,uuid,integer,integer,text)', 'd12c3f0a03a1a6ba4f390c36f45690bf', 's'),
      ('finance_private.closing_receivable_agreement_position(uuid,uuid)', '6173f99261ca7a9cbceb9ee479642351', 's')
    ) value(signature, body_md5, volatility)
  loop
    select * into procedure_record from pg_proc where oid = to_regprocedure(spec.signature);
    if procedure_record.oid is null
      or md5(procedure_record.prosrc) is distinct from spec.body_md5
      or not procedure_record.prosecdef
      or procedure_record.provolatile::text is distinct from spec.volatility
      or procedure_record.proconfig is distinct from array['search_path=""']::text[]
      or has_function_privilege('authenticated', procedure_record.oid, 'execute')
      or has_function_privilege('anon', procedure_record.oid, 'execute')
      or has_function_privilege('service_role', procedure_record.oid, 'execute')
    then
      raise exception 'finance_receivable_agreement_private_predecessor_changed: %', spec.signature using errcode = '55000';
    end if;
  end loop;

  if to_regprocedure('finance_private.dispatch_receivable_agreement_context(uuid,uuid,jsonb)') is not null
    or to_regprocedure('finance_private.dispatch_receivable_agreement_record(jsonb)') is not null
    or to_regprocedure('finance_private.dispatch_receivable_installment_position(uuid,uuid)') is not null
    or to_regprocedure('finance_private.dispatch_receivable_agreement_history(uuid,uuid,integer,integer,text)') is not null
    or to_regprocedure('finance_private.dispatch_receivable_payment_installments(uuid,uuid,uuid,integer,integer,text)') is not null
    or to_regprocedure('finance_private.dispatch_closing_receivable_agreement(uuid,uuid)') is not null
  then
    raise exception 'finance_receivable_agreement_dispatch_target_exists' using errcode = '55000';
  end if;
end
$preflight$;

create function finance_private.dispatch_receivable_agreement_context(_tenant_id uuid, _receivable_id uuid, _proposal jsonb)
returns jsonb language sql stable security definer set search_path = ''
as $$select finance_private.receivable_agreement_context(_tenant_id, _receivable_id, _proposal)$$;
create function finance_private.dispatch_receivable_agreement_record(_payload jsonb)
returns jsonb language sql volatile security definer set search_path = ''
as $$select finance_private.record_receivable_agreement(_payload)$$;
create function finance_private.dispatch_receivable_installment_position(_tenant_id uuid, _receivable_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$select finance_private.receivable_installment_position(_tenant_id, _receivable_id)$$;
create function finance_private.dispatch_receivable_agreement_history(_tenant_id uuid, _receivable_id uuid, _offset integer, _limit integer, _expected_revision text)
returns jsonb language sql stable security definer set search_path = ''
as $$select finance_private.receivable_agreement_history(_tenant_id, _receivable_id, _offset, _limit, _expected_revision)$$;
create function finance_private.dispatch_receivable_payment_installments(_tenant_id uuid, _receivable_id uuid, _payment_id uuid, _offset integer, _limit integer, _expected_revision text)
returns jsonb language sql stable security definer set search_path = ''
as $$select finance_private.receivable_payment_installment_history(_tenant_id, _receivable_id, _payment_id, _offset, _limit, _expected_revision)$$;
create function finance_private.dispatch_closing_receivable_agreement(_tenant_id uuid, _report_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$select finance_private.closing_receivable_agreement_position(_tenant_id, _report_id)$$;

revoke all on function
  finance_private.dispatch_receivable_agreement_context(uuid,uuid,jsonb),
  finance_private.dispatch_receivable_agreement_record(jsonb),
  finance_private.dispatch_receivable_installment_position(uuid,uuid),
  finance_private.dispatch_receivable_agreement_history(uuid,uuid,integer,integer,text),
  finance_private.dispatch_receivable_payment_installments(uuid,uuid,uuid,integer,integer,text),
  finance_private.dispatch_closing_receivable_agreement(uuid,uuid)
from public, anon, authenticated, service_role;
grant execute on function
  finance_private.dispatch_receivable_agreement_context(uuid,uuid,jsonb),
  finance_private.dispatch_receivable_agreement_record(jsonb),
  finance_private.dispatch_receivable_installment_position(uuid,uuid),
  finance_private.dispatch_receivable_agreement_history(uuid,uuid,integer,integer,text),
  finance_private.dispatch_receivable_payment_installments(uuid,uuid,uuid,integer,integer,text),
  finance_private.dispatch_closing_receivable_agreement(uuid,uuid)
to authenticated;

create or replace function public.get_finance_receivable_agreement_context(_tenant_id uuid, _receivable_id uuid, _proposal jsonb)
returns jsonb language sql stable security invoker set search_path = ''
as $$select finance_private.dispatch_receivable_agreement_context(_tenant_id, _receivable_id, _proposal)$$;
create or replace function public.record_finance_receivable_agreement(_payload jsonb)
returns jsonb language sql volatile security invoker set search_path = ''
as $$select finance_private.dispatch_receivable_agreement_record(_payload)$$;
create or replace function public.get_finance_receivable_installment_position(_tenant_id uuid, _receivable_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$select finance_private.dispatch_receivable_installment_position(_tenant_id, _receivable_id)$$;
create or replace function public.get_finance_receivable_agreement_history(_tenant_id uuid, _receivable_id uuid, _offset integer default 0, _limit integer default 30, _expected_revision text default null)
returns jsonb language sql stable security invoker set search_path = ''
as $$select finance_private.dispatch_receivable_agreement_history(_tenant_id, _receivable_id, _offset, _limit, _expected_revision)$$;
create or replace function public.get_finance_receivable_payment_installments(_tenant_id uuid, _receivable_id uuid, _payment_id uuid, _offset integer default 0, _limit integer default 30, _expected_revision text default null)
returns jsonb language sql stable security invoker set search_path = ''
as $$select finance_private.dispatch_receivable_payment_installments(_tenant_id, _receivable_id, _payment_id, _offset, _limit, _expected_revision)$$;
create or replace function public.get_finance_closing_receivable_agreement(_tenant_id uuid, _report_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$select finance_private.dispatch_closing_receivable_agreement(_tenant_id, _report_id)$$;

revoke all on function
  public.get_finance_receivable_agreement_context(uuid,uuid,jsonb),
  public.record_finance_receivable_agreement(jsonb),
  public.get_finance_receivable_installment_position(uuid,uuid),
  public.get_finance_receivable_agreement_history(uuid,uuid,integer,integer,text),
  public.get_finance_receivable_payment_installments(uuid,uuid,uuid,integer,integer,text),
  public.get_finance_closing_receivable_agreement(uuid,uuid)
from public, anon, authenticated, service_role;
grant execute on function
  public.get_finance_receivable_agreement_context(uuid,uuid,jsonb),
  public.record_finance_receivable_agreement(jsonb),
  public.get_finance_receivable_installment_position(uuid,uuid),
  public.get_finance_receivable_agreement_history(uuid,uuid,integer,integer,text),
  public.get_finance_receivable_payment_installments(uuid,uuid,uuid,integer,integer,text),
  public.get_finance_closing_receivable_agreement(uuid,uuid)
to authenticated;

do $postflight$
declare procedure_record record;
begin
  for procedure_record in
    select p.* from pg_proc p where p.oid in (
      'public.get_finance_receivable_agreement_context(uuid,uuid,jsonb)'::regprocedure,
      'public.record_finance_receivable_agreement(jsonb)'::regprocedure,
      'public.get_finance_receivable_installment_position(uuid,uuid)'::regprocedure,
      'public.get_finance_receivable_agreement_history(uuid,uuid,integer,integer,text)'::regprocedure,
      'public.get_finance_receivable_payment_installments(uuid,uuid,uuid,integer,integer,text)'::regprocedure,
      'public.get_finance_closing_receivable_agreement(uuid,uuid)'::regprocedure
    )
  loop
    if procedure_record.prosecdef
      or procedure_record.proconfig is distinct from array['search_path=""']::text[]
      or not has_function_privilege('authenticated', procedure_record.oid, 'execute')
      or has_function_privilege('anon', procedure_record.oid, 'execute')
      or has_function_privilege('service_role', procedure_record.oid, 'execute')
    then raise exception 'finance_receivable_agreement_public_postflight_failed: %', procedure_record.oid::regprocedure using errcode = '55000';
    end if;
  end loop;
end
$postflight$;
