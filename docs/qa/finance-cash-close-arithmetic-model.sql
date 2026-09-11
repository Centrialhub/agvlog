-- Executable read-only arithmetic prototype; not a production RPC or permission to close.
-- $1 tenant, $2 cash account, $3 period start, $4 period end, $5 counts JSON.
-- account_opening already validates cash_count_v1; no bank statement is queried here.
with p as (select $1::uuid tenant,$2::uuid account,$3::date starts,$4::date ends),
position as (
 select finance_private.account_opening(p.tenant,p.account,p.starts,p.ends) value,
  a.account_type='cash' and a.active cash_account
 from p join public.bank_accounts a on a.tenant_id=p.tenant and a.id=p.account
), counted as (select finance_private.cash_count_total($5::jsonb) cents)
select jsonb_build_object('version',1,'diagnostic_only',true,'evidence_type','cash_count_v1',
 'cash_account',cash_account,'opening',value->'opening','book',value->'book',
 'counted_cents',cents::text,
 'difference_cents',case when cash_account and value#>>'{opening,evidence_status}'='valid' then (cents-(value#>>'{book,closing_cents}')::numeric)::text end,
 'money_created',false,'closure_authorization_produced',false)
from position cross join counted;
