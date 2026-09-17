-- Live bug queue 190, 193, 194, 198, 201, 204-206 and 217.

create or replace function public.tg_preserve_billing_snapshots_and_dates() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare client_row jsonb; company_row jsonb;
begin
 if new.due_date is not null and new.due_date<new.issue_date then
  raise exception 'invoice_due_before_issue' using errcode='23514';
 end if;
 if new.payer_snapshot='{}'::jsonb then
  select to_jsonb(c) into client_row from public.clients c where c.tenant_id=new.tenant_id and c.id=new.client_id;
  new.payer_snapshot:=coalesce(client_row,'{}'::jsonb);
 end if;
 if new.company_snapshot='{}'::jsonb then
  select jsonb_build_object('tenant_id',t.id,'name',t.name,'company',coalesce(t.settings->'company','{}'::jsonb))
    into company_row from public.tenants t where t.id=new.tenant_id;
  new.company_snapshot:=coalesce(company_row,'{}'::jsonb);
 end if;
 return new;
end;$fn$;
revoke all on function public.tg_preserve_billing_snapshots_and_dates() from public,anon,authenticated,service_role;
drop trigger if exists preserve_billing_snapshots_and_dates on public.client_invoices;
create trigger preserve_billing_snapshots_and_dates before insert on public.client_invoices
for each row execute function public.tg_preserve_billing_snapshots_and_dates();

create or replace function public.tg_preserve_closing_snapshots_and_dates() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare client_row jsonb; company_row jsonb;
begin
 if new.expected_payment_date is not null and new.expected_payment_date<new.period_end then
  raise exception 'closing_due_before_period_end' using errcode='23514';
 end if;
 if new.client_snapshot='{}'::jsonb then
  select to_jsonb(c) into client_row from public.clients c where c.tenant_id=new.tenant_id and c.id=coalesce(new.payer_client_id,new.client_id);
  new.client_snapshot:=coalesce(client_row,'{}'::jsonb);
 end if;
 if new.company_snapshot='{}'::jsonb then
  select jsonb_build_object('tenant_id',t.id,'name',t.name,'company',coalesce(t.settings->'company','{}'::jsonb))
    into company_row from public.tenants t where t.id=new.tenant_id;
  new.company_snapshot:=coalesce(company_row,'{}'::jsonb);
 end if;
 return new;
end;$fn$;
revoke all on function public.tg_preserve_closing_snapshots_and_dates() from public,anon,authenticated,service_role;
drop trigger if exists preserve_closing_snapshots_and_dates on public.closing_reports;
create trigger preserve_closing_snapshots_and_dates before insert on public.closing_reports
for each row execute function public.tg_preserve_closing_snapshots_and_dates();

-- History is command-owned. Authenticated callers retain SELECT, while the
-- security-definer command functions continue to write as their owner.
drop policy if exists edi_exports_write on public.billing_edi_exports;
drop policy if exists edi_items_write on public.billing_edi_export_items;
revoke insert,update,delete on public.billing_edi_exports from authenticated;
revoke insert,update,delete on public.billing_edi_export_items from authenticated;

create or replace function public.mark_doccob_sent(_tenant_id uuid,_export_id uuid,_channel text default 'manual',_sent_to text default null)
returns void language plpgsql security definer set search_path='' as $fn$
declare affected integer;
begin
 if not public.is_tenant_operator_or_admin(_tenant_id) then raise exception 'not_authorized' using errcode='42501';end if;
 if coalesce(length(btrim(_channel)),0) not between 2 and 100 or coalesce(length(btrim(_sent_to)),0) not between 2 and 500 then
  raise exception 'doccob_send_evidence_required' using errcode='22023';
 end if;
 update public.billing_edi_exports set status='sent',sent_at=now(),sent_channel=btrim(_channel),sent_to=btrim(_sent_to)
 where id=_export_id and tenant_id=_tenant_id and status not in('cancelled','sent');
 get diagnostics affected=row_count;if affected<>1 then raise exception 'doccob_export_not_sendable' using errcode='23514';end if;
 update public.client_invoices ci set edi_status='sent',edi_sent_at=now()
 from public.billing_edi_export_items it where it.export_id=_export_id and it.tenant_id=_tenant_id
  and it.client_invoice_id=ci.id and it.status='included';
end;$fn$;
revoke all on function public.mark_doccob_sent(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.mark_doccob_sent(uuid,uuid,text,text) to authenticated,service_role;

-- Validate the browser-produced bundle against authoritative rows before the
-- existing registration implementation runs.
do $doccob_validation$
declare body text; marker text:='  -- Valida faturas'; injected text;
begin
 select pg_get_functiondef('public.register_doccob_export(uuid,uuid,uuid,uuid[],text,date,text,text,integer,numeric,integer,integer,text)'::regprocedure) into body;
 if position('doccob_authoritative_bundle_check' in body)>0 then return;end if;
 if position(marker in body)=0 then raise exception 'doccob_register_contract_changed';end if;
 injected:=$sql$  -- doccob_authoritative_bundle_check
  IF cardinality(_client_invoice_ids) <> (SELECT count(DISTINCT value) FROM unnest(_client_invoice_ids) value)
     OR _content_hash IS DISTINCT FROM encode(sha256(convert_to(_generated_content,'UTF8')),'hex')
     OR _total_amount IS DISTINCT FROM (SELECT coalesce(sum(total_amount),0) FROM public.client_invoices WHERE tenant_id=_tenant_id AND id=ANY(_client_invoice_ids))
     OR _charge_count IS DISTINCT FROM (SELECT count(*) FROM public.client_invoice_charges WHERE tenant_id=_tenant_id AND invoice_id=ANY(_client_invoice_ids) AND cancelled_at IS NULL)
     OR _detail_count IS DISTINCT FROM (SELECT count(*) FROM public.client_invoice_details WHERE tenant_id=_tenant_id AND invoice_id=ANY(_client_invoice_ids)) THEN
    RAISE EXCEPTION 'doccob_bundle_mismatch' USING ERRCODE='40001';
  END IF;

$sql$;
 execute replace(body,marker,injected||marker);
end;$doccob_validation$;

-- Manual intervention is data carried by the immutable event, not a list that
-- needs to be updated for every new command.
do $audit_manual$
declare body text; changed text;
begin
 select pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure) into body;
 changed:=regexp_replace(body,$re$e\.action in\([^)]*\) manual_intervention$re$,
  $to$coalesce((e.after_data->>'manual_intervention')::boolean,false) manual_intervention$to$,'g');
 changed:=regexp_replace(changed,$re$or e\.action in\([^)]*\)\)$re$,
  $to$or coalesce((e.after_data->>'manual_intervention')::boolean,false))$to$,'g');
 if changed=body then raise exception 'finance_audit_manual_contract_changed';end if;
 execute changed;
end;$audit_manual$;
