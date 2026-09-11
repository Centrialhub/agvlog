create function finance_private.automatic_reconciliation_status(_tenant uuid,_import uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare i public.finance_statement_imports%rowtype;v public.finance_statement_verifications%rowtype;
 j public.finance_automatic_reconciliation_jobs%rowtype;scheduler boolean:=false;state text;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into i from public.finance_statement_imports where tenant_id=_tenant and id=_import;
 if not found then raise exception 'finance_statement_not_found' using errcode='22023';end if;
 select * into v from public.finance_statement_verifications where tenant_id=_tenant and import_id=_import order by created_at desc,id desc limit 1;
 select * into j from public.finance_automatic_reconciliation_jobs where tenant_id=_tenant and import_id=_import and verification_id=v.id;
 if to_regclass('cron.job') is not null then
  execute 'select exists(select 1 from cron.job where jobname=''finance-bank-reconciliation-every-minute'' and active)' into scheduler;
 end if;
 state:=case when i.parser_version<>'native-ofx-v1' then 'unsupported_format' when v.outcome is distinct from 'rows_match' then 'waiting_source'
  when j.verification_id is null then 'not_queued' else j.status end;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'import_id',_import,'status',state,'scheduler_active',scheduler,
  'matched_count',coalesce(j.matched_count,0),'issue',j.issue,'updated_at',j.updated_at,'verification_id',v.id);
end;$$;
revoke all on function finance_private.automatic_reconciliation_status(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function finance_private.automatic_reconciliation_status(uuid,uuid) to authenticated;
create function public.get_finance_automatic_reconciliation_status(_tenant_id uuid,_import_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.automatic_reconciliation_status(_tenant_id,_import_id)$$;
revoke all on function public.get_finance_automatic_reconciliation_status(uuid,uuid) from public,anon,service_role;
grant execute on function public.get_finance_automatic_reconciliation_status(uuid,uuid) to authenticated;
