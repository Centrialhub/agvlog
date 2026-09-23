set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $migration$
declare
  register_definition text;
  validator_definition text;
  previous_definition text;
  register_old text := '(SELECT count(*) FROM public.client_invoice_details WHERE tenant_id=_tenant_id AND invoice_id=ANY(_client_invoice_ids))';
  register_new text := '(SELECT count(*) FROM public.client_invoice_details detail JOIN public.client_invoice_charges charge ON charge.tenant_id=detail.tenant_id AND charge.id=detail.charge_id AND charge.invoice_id=detail.invoice_id WHERE detail.tenant_id=_tenant_id AND detail.invoice_id=ANY(_client_invoice_ids) AND charge.cancelled_at IS NULL)';
  validator_old text := '(select count(*) from public.client_invoice_details where tenant_id=_tenant_id and invoice_id=any(_invoice_ids))';
  validator_new text := '(select count(*) from public.client_invoice_details detail join public.client_invoice_charges charge on charge.tenant_id=detail.tenant_id and charge.id=detail.charge_id and charge.invoice_id=detail.invoice_id where detail.tenant_id=_tenant_id and detail.invoice_id=any(_invoice_ids) and charge.cancelled_at is null)';
begin
  if to_regprocedure('public.register_doccob_export(uuid,uuid,uuid,uuid[],text,date,text,text,integer,numeric,integer,integer,text)') is null
    or to_regprocedure('public.validate_doccob_content_v1(uuid,uuid[],text,integer)') is null then
    raise exception 'DOCCOB validation dependency is missing';
  end if;

  select pg_get_functiondef('public.register_doccob_export(uuid,uuid,uuid,uuid[],text,date,text,text,integer,numeric,integer,integer,text)'::regprocedure)
    into register_definition;
  previous_definition := register_definition;
  register_definition := replace(register_definition, register_old, register_new);
  if register_definition = previous_definition then
    raise exception 'DOCCOB registration detail-count contract changed';
  end if;
  execute register_definition;

  select pg_get_functiondef('public.validate_doccob_content_v1(uuid,uuid[],text,integer)'::regprocedure)
    into validator_definition;
  previous_definition := validator_definition;
  validator_definition := replace(validator_definition, validator_old, validator_new);
  if validator_definition = previous_definition then
    raise exception 'DOCCOB content detail-count contract changed';
  end if;
  execute validator_definition;
end;
$migration$;

comment on function public.validate_doccob_content_v1(uuid,uuid[],text,integer) is
  'Validates the browser DOCCOB bundle against invoices, active charges and only the details belonging to those active charges.';
