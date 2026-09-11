create function finance_private.receivable_payment_page_rows(_tenant uuid,_receivable uuid)
returns table(id uuid,received_at timestamptz,value jsonb) language sql stable set search_path='' as $$
 select p.id,p.received_at,jsonb_build_object('id',p.id,'amount_cents',trunc(p.amount*100)::bigint,
  'received_at',p.received_at,'method',p.method,'notes',p.notes,'bank_account_id',p.bank_account_id,
  'bank_account_name',a.name,'attachment_path',p.attachment_url,'reversed_at',rv.created_at,'reversal_reason',rv.reason,
  'credit_id',credit.id,'allocation_correction',case when correction.id is not null then jsonb_build_object(
   'id',correction.id,'actor_id',correction.actor_id,'actor_name',correction.actor_name,'reason',correction.reason,'created_at',correction.created_at) end)
 from public.receivables_payments p
 left join public.bank_accounts a on a.tenant_id=p.tenant_id and a.id=p.bank_account_id
 left join public.receivable_payment_reversals rv on rv.tenant_id=p.tenant_id and rv.payment_id=p.id
 left join public.finance_customer_credits credit on credit.tenant_id=p.tenant_id and credit.payment_id=p.id
 left join public.finance_receipt_allocation_corrections correction on correction.tenant_id=p.tenant_id and correction.payment_id=p.id
 where p.tenant_id=_tenant and p.receivable_id=_receivable
$$;
revoke all on function finance_private.receivable_payment_page_rows(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.receivable_payments_page(_tenant uuid,_receivable uuid,_page integer,_expected_revision text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare total bigint;revision text;rows jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page<1 then raise exception 'finance_invalid_history_page' using errcode='22023';end if;
 if _page>1 and _expected_revision is null then raise exception 'finance_history_revision_required' using errcode='22023';end if;
 if not exists(select 1 from public.receivables r where r.tenant_id=_tenant and r.id=_receivable) then
  raise exception 'financial_receivable_not_found' using errcode='22023';end if;
 -- The existing payment contract uses safe integer numbers, not arbitrary
 -- numeric strings. Fail explicitly instead of rounding damaged legacy data.
 if exists(select 1 from public.receivables_payments p where p.tenant_id=_tenant and p.receivable_id=_receivable and
  (p.amount is null or p.amount::text in('NaN','Infinity','-Infinity') or p.amount<=0 or p.amount*100<>trunc(p.amount*100)
   or p.amount*100>99999999999999 or p.received_at is null or not isfinite(p.received_at))) then
  raise exception 'finance_payment_history_invalid' using errcode='23514';end if;
 select count(*),md5(jsonb_build_object('version',1,'tenant_id',_tenant,'receivable_id',_receivable,
  'rows_hash',md5(coalesce(string_agg(md5(value::text),'' order by received_at desc,id asc),'')))::text)
 into total,revision from finance_private.receivable_payment_page_rows(_tenant,_receivable);
 if _expected_revision is not null and _expected_revision is distinct from revision then
  raise exception 'finance_history_changed' using errcode='40001';end if;
 select coalesce(jsonb_agg(value order by received_at desc,id asc),'[]') into rows from(
  select * from finance_private.receivable_payment_page_rows(_tenant,_receivable)
  order by received_at desc,id asc limit 50 offset ((_page::bigint-1)*50)
 ) page_rows;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'receivable_id',_receivable,
  'page',_page,'page_size',50,'total',total,'revision',revision,'rows',rows);
end$$;
revoke all on function finance_private.receivable_payments_page(uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.receivable_payments_page(uuid,uuid,integer,text) to authenticated;
create function public.get_finance_receivable_payments_page(_tenant_id uuid,_receivable_id uuid,_page integer default 1,_expected_revision text default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 select finance_private.receivable_payments_page(_tenant_id,_receivable_id,_page,_expected_revision)
$$;
revoke all on function public.get_finance_receivable_payments_page(uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_receivable_payments_page(uuid,uuid,integer,text) to authenticated;
