set local lock_timeout = '3s';
set local statement_timeout = '30s';

create or replace function public.cancel_doccob_export(
  _tenant_id uuid,
  _export_id uuid,
  _reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target public.billing_edi_exports%rowtype;
  normalized_reason text := btrim(_reason);
begin
  if not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if coalesce(length(normalized_reason), 0) not between 5 and 1000 then
    raise exception 'doccob_cancellation_reason_invalid' using errcode = '22023';
  end if;

  select * into target
  from public.billing_edi_exports export
  where export.tenant_id = _tenant_id and export.id = _export_id
  for update;
  if not found then
    raise exception 'doccob_export_not_found' using errcode = 'P0002';
  end if;
  if target.status not in ('generated', 'downloaded', 'error') then
    raise exception 'doccob_export_not_cancelable' using errcode = '23514';
  end if;

  update public.billing_edi_exports
  set status = 'cancelled', cancelled_at = now(), cancellation_reason = normalized_reason
  where tenant_id = _tenant_id and id = _export_id;

  update public.billing_edi_export_items
  set status = 'cancelled'
  where tenant_id = _tenant_id and export_id = _export_id and status = 'included';

  update public.client_invoices invoice
  set edi_status = 'not_generated', last_edi_export_id = null,
      edi_generated_at = null, edi_sent_at = null
  where invoice.tenant_id = _tenant_id and invoice.last_edi_export_id = _export_id;
end;
$function$;

revoke all on function public.cancel_doccob_export(uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_doccob_export(uuid,uuid,text)
  to authenticated, service_role;
