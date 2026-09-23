create or replace function finance_private.legacy_receivable_association(
  _tenant uuid,
  _payment uuid,
  _page integer,
  _expected_revision text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  payment public.receivables_payments%rowtype;
  receivable public.receivables%rowtype;
  issue text;
  received_day date;
  amount bigint;
  result jsonb;
  active_link uuid;
begin
  if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501'; end if;
  if _page is null or _page not between 1 and 100000 or (_expected_revision is not null and _expected_revision!~'^[a-f0-9]{32}$') then
    raise exception 'finance_invalid_filters' using errcode='22023';
  end if;
  select * into payment from public.receivables_payments where tenant_id=_tenant and id=_payment;
  if not found then raise exception 'finance_payment_not_found' using errcode='22023'; end if;
  select * into receivable from public.receivables where tenant_id=_tenant and id=payment.receivable_id;
  issue:=finance_private.legacy_receivable_payment_issue(_tenant,_payment);
  if payment.received_at is not null and isfinite(payment.received_at) then received_day:=(payment.received_at at time zone 'America/Sao_Paulo')::date; end if;
  if payment.amount is not null and payment.amount::text not in('NaN','Infinity','-Infinity') and payment.amount>0
     and payment.amount*100=trunc(payment.amount*100) and payment.amount*100<=99999999999999 then amount:=(payment.amount*100)::bigint; end if;
  select l.id into active_link from public.finance_legacy_receipt_movement_links l where l.tenant_id=_tenant and l.payment_id=_payment
    and not exists(select 1 from public.finance_legacy_receipt_link_reversals r where r.tenant_id=_tenant and r.link_id=l.id);

  with movement_capacity as materialized(
    select m.id,m.bank_account_id,a.name account_name,m.beneficiary_name,m.description,m.occurred_on,m.bank_reference,m.amount_cents,
      finance_private.receipt_movement_used_cents(_tenant,m.id) used_cents
    from finance_private.active_movements m
    join public.bank_accounts a on a.tenant_id=m.tenant_id and a.id=m.bank_account_id
    where m.tenant_id=_tenant and m.bank_account_id=payment.bank_account_id and m.occurred_on=received_day
      and m.direction='in' and m.nature in('receipt','customer_advance','other')
  ), candidates as materialized(
    select id,bank_account_id,account_name,beneficiary_name,description,occurred_on,bank_reference,
      amount_cents::text amount_cents,(amount_cents-used_cents)::bigint::text remaining_cents
    from movement_capacity
    where issue is null and amount_cents-used_cents>=amount
  ), page_rows as (
    select * from candidates order by id limit 20 offset (_page-1)*20
  ), history as materialized(
    select l.id,l.movement_id,l.amount_cents::text,l.created_by actor_id,l.actor_name,l.reason,l.created_at,'legacy_adoption'::text origin,
      (select jsonb_build_object('id',r.id,'actor_id',r.created_by,'actor_name',r.actor_name,'reason',r.reason,'created_at',r.created_at)
       from public.finance_legacy_receipt_link_reversals r where r.tenant_id=_tenant and r.link_id=l.id) reversal
    from public.finance_legacy_receipt_movement_links l where l.tenant_id=_tenant and l.payment_id=_payment
  ), history_page as (
    select * from history order by created_at desc,id desc limit 20 offset (_page-1)*20
  ), fingerprint as (
    select md5(jsonb_build_object(
      'source',finance_private.legacy_receivable_source_revision(_tenant,_payment),
      'movements',coalesce((select jsonb_agg(jsonb_build_array(id,amount_cents,used_cents) order by id) from movement_capacity),'[]'::jsonb),
      'history',coalesce((select jsonb_agg(jsonb_build_array(to_jsonb(h)-'reversal',h.reversal) order by h.created_at,h.id) from history h),'[]'::jsonb)
    )::text) page_revision
  )
  select jsonb_build_object(
    'version',1,'tenant_id',_tenant,'payment_id',_payment,'revision',finance_private.legacy_receivable_source_revision(_tenant,_payment),
    'page_revision',f.page_revision,'page',_page,'page_size',20,'total',(select count(*) from candidates),
    'rows',coalesce((select jsonb_agg(to_jsonb(p) order by id) from page_rows p),'[]'),
    'payment',jsonb_build_object('id',payment.id,'receivable_id',payment.receivable_id,'bank_account_id',payment.bank_account_id,
      'account_name',(select a.name from public.bank_accounts a where a.tenant_id=_tenant and a.id=payment.bank_account_id),
      'payer_name',(select coalesce(nullif(btrim(to_jsonb(c)->>'company_name'),''),nullif(btrim(to_jsonb(c)->>'name'),'')) from public.clients c where c.tenant_id=_tenant and c.id=receivable.client_id),
      'received_on',received_day,'amount_cents',amount::text,'bank_transaction_id',payment.bank_transaction_id),
    'eligible',issue is null,'issue',issue,'active_link',active_link,'history_total',(select count(*) from history),
    'history',coalesce((select jsonb_agg(to_jsonb(h) order by created_at desc,id desc) from history_page h),'[]')
  ) into result
  from fingerprint f;

  if _expected_revision is not null and _expected_revision is distinct from result->>'page_revision' then
    raise exception 'finance_legacy_association_page_changed' using errcode='40001';
  end if;
  return result;
end;
$function$;

revoke all on function finance_private.legacy_receivable_association(uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.legacy_receivable_association(uuid,uuid,integer,text) to authenticated;
