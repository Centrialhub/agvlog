-- Final browser ACL closure for privileged implementations that now sit behind
-- audited command RPCs. This migration intentionally does not change function
-- bodies or service_role privileges. It also fails closed unless every
-- replacement API is present and executable by authenticated users.

do $preflight$
declare
  signature text;
begin
  foreach signature in array array[
    'public.add_driver_settlement_adjustment(uuid,text,numeric,text,text)',
    'public.remove_driver_settlement_adjustment(uuid,uuid,text)',
    'public.add_driver_settlement_manual_expense(uuid,text,numeric,timestamptz,text,text,boolean,text,text)',
    'public.driver_create_expense(uuid,text,numeric,text,text,timestamptz,text,text,text,text,numeric,boolean,text,boolean,text,boolean)',
    'public.create_client_invoice(jsonb)',
    'public.generate_client_invoice_from_closing(uuid)',
    'public.cancel_client_invoice(uuid,text)',
    'public.next_closing_report_number(uuid,date)',
    'public.close_closing_report(uuid)',
    'public.cancel_closing_report(uuid,text)',
    'public.reopen_closing_report(uuid,text)',
    'public.register_closing_report_payment(uuid,jsonb)',
    'public.register_receivable_payment(uuid,numeric,timestamptz,uuid,text,text,text)',
    'public.reverse_receivable_payment(uuid)'
  ] loop
    if to_regprocedure(signature) is null then
      raise exception 'Legacy ACL target is missing: %', signature;
    end if;
  end loop;

  foreach signature in array array[
    'public.apply_driver_settlement_adjustment(jsonb)',
    'public.create_driver_expense_command(jsonb)',
    'public.apply_client_invoice_command(jsonb)',
    'public.create_closing_report_draft(jsonb)',
    'public.apply_closing_report_action(jsonb)',
    'public.apply_receivable_financial_command(jsonb)'
  ] loop
    if to_regprocedure(signature) is null
       or not has_function_privilege('authenticated', to_regprocedure(signature), 'EXECUTE') then
      raise exception 'Canonical authenticated RPC is not ready: %', signature;
    end if;
  end loop;
end;
$preflight$;

-- Driver settlement adjustments: public callers use
-- apply_driver_settlement_adjustment(jsonb).
revoke all privileges on function
  public.add_driver_settlement_adjustment(uuid,text,numeric,text,text),
  public.remove_driver_settlement_adjustment(uuid,uuid,text)
from public, anon, authenticated;

-- Driver expense creation: public callers use
-- create_driver_expense_command(jsonb).
revoke all privileges on function
  public.add_driver_settlement_manual_expense(uuid,text,numeric,timestamptz,text,text,boolean,text,text),
  public.driver_create_expense(uuid,text,numeric,text,text,timestamptz,text,text,text,text,numeric,boolean,text,boolean,text,boolean)
from public, anon, authenticated;

-- Client invoice lifecycle: public callers use
-- apply_client_invoice_command(jsonb).
revoke all privileges on function
  public.create_client_invoice(jsonb),
  public.generate_client_invoice_from_closing(uuid),
  public.cancel_client_invoice(uuid,text)
from public, anon, authenticated;

-- Closing report creation/lifecycle: public callers use
-- create_closing_report_draft(jsonb) and apply_closing_report_action(jsonb).
revoke all privileges on function
  public.next_closing_report_number(uuid,date),
  public.close_closing_report(uuid),
  public.cancel_closing_report(uuid,text),
  public.reopen_closing_report(uuid,text)
from public, anon, authenticated;

-- Receivable settlement: public callers use
-- apply_receivable_financial_command(jsonb).
revoke all privileges on function
  public.register_closing_report_payment(uuid,jsonb),
  public.register_receivable_payment(uuid,numeric,timestamptz,uuid,text,text,text),
  public.reverse_receivable_payment(uuid)
from public, anon, authenticated;
