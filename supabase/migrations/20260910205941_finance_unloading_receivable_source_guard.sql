create function finance_private.guard_unloading_receivable_source() returns trigger
language plpgsql security definer set search_path='' as $$
declare t uuid; rid uuid; r public.receivables%rowtype; c public.finance_unloading_charges%rowtype;
begin
 if tg_table_name='receivables' then
  t:=old.tenant_id; rid:=old.id;
 else
  t:=new.tenant_id; rid:=new.receivable_id;
 end if;
 -- Row-first legacy writers must never wait for the finance lock.
 if not pg_try_advisory_xact_lock(hashtextextended(t::text||':finance',0)) then
  raise exception 'finance_unloading_source_busy' using errcode='40001';
 end if;
 if tg_table_name='receivables' then
  if not exists(select 1 from public.finance_unloading_charges where tenant_id=t and receivable_id=rid) then
   if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_op='DELETE' then raise exception 'finance_unloading_source_immutable' using errcode='55000'; end if;
  if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
    or new.client_id is distinct from old.client_id or new.amount is distinct from old.amount
    or new.client_invoice_id is distinct from old.client_invoice_id
    or new.closing_report_id is distinct from old.closing_report_id
    or to_jsonb(new)->'fiscal_document_id' is distinct from to_jsonb(old)->'fiscal_document_id'
    or to_jsonb(new)->'cte_document_id' is distinct from to_jsonb(old)->'cte_document_id' then
   raise exception 'finance_unloading_source_immutable' using errcode='55000';
  end if;
  if (new.status in ('cancelled','invoiced') or old.status in ('cancelled','invoiced')) and new.status is distinct from old.status then
   raise exception 'finance_unloading_status_requires_command' using errcode='55000';
  end if;
  return new;
 end if;
 if tg_table_name='finance_unloading_charges' then c:=new;
 else
  select * into c from public.finance_unloading_charges where tenant_id=t and receivable_id=rid;
  if not found then return new; end if;
 end if;
 begin
  select * into r from public.receivables where tenant_id=t and id=rid for share nowait;
 exception when lock_not_available then
  raise exception 'finance_unloading_source_busy' using errcode='40001';
 end;
 if r.id is null or r.client_id is distinct from c.supplier_id or r.amount is null
   or r.amount::text in ('NaN','Infinity','-Infinity') or r.amount*100 is distinct from c.amount_cents::numeric
   or r.client_invoice_id is not null or r.closing_report_id is not null
   or to_jsonb(r)->>'fiscal_document_id' is not null or to_jsonb(r)->>'cte_document_id' is not null
   or r.status in ('cancelled','invoiced') then
  raise exception 'finance_unloading_source_mismatch' using errcode='55000';
 end if;
 return new;
end $$;
revoke all on function finance_private.guard_unloading_receivable_source() from public,anon,authenticated,service_role;
create trigger a_unloading_receivable_source before update or delete on public.receivables
 for each row execute function finance_private.guard_unloading_receivable_source();
create trigger a_unloading_charge_source before insert on public.finance_unloading_charges
 for each row execute function finance_private.guard_unloading_receivable_source();
create trigger a_unloading_receipt_source before insert on public.receivables_payments
 for each row execute function finance_private.guard_unloading_receivable_source();

-- Preserve the writer's OID/ACL and all source/evidence guards; reauthorize before replay.
do $patch$
declare body text; needle text := 'perform pg_advisory_xact_lock(hashtextextended(t::text||'':finance'',0));';
begin
 body:=pg_get_functiondef('finance_private.record_unloading(jsonb)'::regprocedure);
 if position(needle in body)=0 then raise exception 'unloading_writer_definition_changed'; end if;
 body:=replace(body,needle,needle||E'\n if not finance_private.can_access(t) then raise exception ''finance_access_denied'' using errcode=''42501''; end if;');
 execute body;
end $patch$;
