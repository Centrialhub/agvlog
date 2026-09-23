create or replace function finance_private.receivable_payments_page(
  _tenant uuid,
  _receivable uuid,
  _page integer,
  _expected_revision text
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  total bigint;
  revision text;
  rows jsonb;
  page_start bigint := (_page::bigint-1)*50;
begin
  if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501'; end if;
  if _page is null or _page<1 then raise exception 'finance_invalid_history_page' using errcode='22023'; end if;
  if _page>1 and _expected_revision is null then raise exception 'finance_history_revision_required' using errcode='22023'; end if;
  if not exists(select 1 from public.receivables r where r.tenant_id=_tenant and r.id=_receivable) then
    raise exception 'financial_receivable_not_found' using errcode='22023';
  end if;
  if exists(
    select 1 from public.receivables_payments p
    where p.tenant_id=_tenant and p.receivable_id=_receivable and
      (p.amount is null or p.amount::text in('NaN','Infinity','-Infinity') or p.amount<=0 or p.amount*100<>trunc(p.amount*100)
       or p.amount*100>99999999999999 or p.received_at is null or not isfinite(p.received_at))
  ) then
    raise exception 'finance_payment_history_invalid' using errcode='23514';
  end if;

  with all_rows as materialized(
    select * from finance_private.receivable_payment_page_rows(_tenant,_receivable)
  ), numbered as materialized(
    select *,row_number() over(order by received_at desc,id asc) ordinal
    from all_rows
  )
  select count(*),
    md5(jsonb_build_object(
      'version',1,
      'tenant_id',_tenant,
      'receivable_id',_receivable,
      'rows_hash',md5(coalesce(string_agg(md5(value::text),'' order by received_at desc,id asc),''))
    )::text),
    coalesce(jsonb_agg(value order by received_at desc,id asc)
      filter(where ordinal>page_start and ordinal<=page_start+50),'[]'::jsonb)
  into total,revision,rows
  from numbered;

  if _expected_revision is not null and _expected_revision is distinct from revision then
    raise exception 'finance_history_changed' using errcode='40001';
  end if;
  return jsonb_build_object(
    'version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'receivable_id',_receivable,
    'page',_page,'page_size',50,'total',total,'revision',revision,'rows',rows
  );
end;
$function$;

revoke all on function finance_private.receivable_payments_page(uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.receivable_payments_page(uuid,uuid,integer,text) to authenticated;
