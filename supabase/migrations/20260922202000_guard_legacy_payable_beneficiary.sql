create or replace function finance_private.check_legacy_payable_beneficiary()
returns trigger language plpgsql security definer set search_path='' as $$
declare title public.payables%rowtype; movement public.finance_movements%rowtype;
begin
 if new.origin <> 'legacy_adoption' then return new; end if;
 select * into title from public.payables where tenant_id=new.tenant_id and id=new.payable_id;
 select * into movement from public.finance_movements where tenant_id=new.tenant_id and id=new.movement_id;
 if not found then raise exception 'finance_invalid_payment_movement' using errcode='22023'; end if;
 if title.driver_id is null and (
  nullif(lower(regexp_replace(btrim(title.supplier_name),'\s+',' ','g')),'') is null
  or nullif(lower(regexp_replace(btrim(movement.beneficiary_name),'\s+',' ','g')),'') is null
  or lower(regexp_replace(btrim(title.supplier_name),'\s+',' ','g')) is distinct from lower(regexp_replace(btrim(movement.beneficiary_name),'\s+',' ','g'))
 ) then raise exception 'finance_legacy_payable_beneficiary_mismatch' using errcode='23514'; end if;
 return new;
end$$;
revoke all on function finance_private.check_legacy_payable_beneficiary() from public,anon,authenticated,service_role;
drop trigger if exists finance_check_legacy_payable_beneficiary on public.finance_payable_movement_links;
create trigger finance_check_legacy_payable_beneficiary before insert on public.finance_payable_movement_links
for each row execute function finance_private.check_legacy_payable_beneficiary();

do $$declare body text;needle text;replacement text;begin
 select pg_get_functiondef('finance_private.manage_legacy_payable_association(jsonb,boolean)'::regprocedure) into body;
 needle:=$n$array['version','tenant_id','request_id','payment_id','movement_id','revision','reason']$n$;
 replacement:=$n$array['version','tenant_id','request_id','payment_id','movement_id','revision','reason','existing_payment_confirmed']$n$;
 if position(needle in body)=0 then raise exception 'finance_legacy_payable_payload_contract_changed';end if;
 body:=replace(body,needle,replacement);
 needle:=$n$if not _reverse and (jsonb_typeof(_payload->'revision') is distinct from 'string' or coalesce(_payload->>'revision','') !~ '^[a-f0-9]{32}$') then raise exception 'finance_invalid_payload' using errcode='22023';end if;$n$;
 replacement:=needle||$n$
 if not _reverse and _payload->'existing_payment_confirmed' is distinct from 'true'::jsonb then raise exception 'finance_invalid_payment_declaration' using errcode='22023';end if;$n$;
 if position(needle in body)=0 then raise exception 'finance_legacy_payable_revision_contract_changed';end if;
 execute replace(body,needle,replacement);
end$$;

create or replace function finance_private.legacy_payable_association(_tenant uuid,_payment uuid,_page integer,_expected_revision text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare payment public.payables_payments%rowtype;payable public.payables%rowtype;
 issue text;paid_day date;amount bigint;result jsonb;active_link uuid;page_revision text;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page not between 1 and 100000 or (_expected_revision is not null and _expected_revision!~'^[a-f0-9]{32}$') then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 select * into payment from public.payables_payments where tenant_id=_tenant and id=_payment;
 if not found then raise exception 'finance_payment_not_found' using errcode='22023';end if;
 select * into payable from public.payables where tenant_id=_tenant and id=payment.payable_id;
 issue:=finance_private.legacy_payable_payment_issue(_tenant,_payment);
 if payment.paid_at is not null and isfinite(payment.paid_at) then paid_day:=(payment.paid_at at time zone 'America/Sao_Paulo')::date;end if;
 if payment.amount is not null and payment.amount::text not in('NaN','Infinity','-Infinity') and payment.amount>0
  and payment.amount*100=trunc(payment.amount*100) and payment.amount*100<=99999999999999 then amount:=(payment.amount*100)::bigint;end if;
 page_revision:=finance_private.legacy_payable_catalog_revision(_tenant,_payment);
 if _expected_revision is not null and _expected_revision is distinct from page_revision then raise exception 'finance_legacy_association_page_changed' using errcode='40001';end if;
 select l.id into active_link from public.finance_payable_movement_links l where l.tenant_id=_tenant and l.payment_id=_payment and l.origin='legacy_adoption'
  and not exists(select 1 from public.finance_payable_link_reversals r where r.tenant_id=_tenant and r.link_id=l.id);
 with candidates as materialized(
  select m.id,m.bank_account_id,a.name account_name,m.beneficiary_name,m.description,m.occurred_on,m.bank_reference,
   m.amount_cents::text amount_cents,(m.amount_cents-finance_private.movement_used_cents(_tenant,m.id))::text remaining_cents
  from finance_private.active_movements m join public.bank_accounts a on a.tenant_id=m.tenant_id and a.id=m.bank_account_id
  where issue is null and m.tenant_id=_tenant and m.bank_account_id=payment.bank_account_id and m.occurred_on=paid_day
   and m.direction='out' and m.nature<>'transfer' and (payable.driver_id is null or m.driver_id=payable.driver_id)
   and (payable.driver_id is not null or (
    nullif(lower(regexp_replace(btrim(payable.supplier_name),'\s+',' ','g')),'') is not null
    and nullif(lower(regexp_replace(btrim(m.beneficiary_name),'\s+',' ','g')),'') is not null
    and lower(regexp_replace(btrim(payable.supplier_name),'\s+',' ','g'))=lower(regexp_replace(btrim(m.beneficiary_name),'\s+',' ','g'))
   ))
   and m.amount_cents-finance_private.movement_used_cents(_tenant,m.id)>=amount
 ),page_rows as(select * from candidates order by id limit 20 offset (_page-1)*20),
 history as materialized(
  select l.id,l.movement_id,l.amount_cents::text,l.created_by actor_id,l.actor_name,l.reason,l.created_at,l.origin,
   (select jsonb_build_object('id',r.id,'actor_id',r.created_by,'actor_name',r.actor_name,'reason',r.reason,'created_at',r.created_at)
    from public.finance_payable_link_reversals r where r.tenant_id=_tenant and r.link_id=l.id) reversal
  from public.finance_payable_movement_links l where l.tenant_id=_tenant and l.payment_id=_payment and l.origin='legacy_adoption'
 ),history_page as(select * from history order by created_at desc,id desc limit 20 offset (_page-1)*20)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'payment_id',_payment,'revision',finance_private.legacy_payable_source_revision(_tenant,_payment),'page_revision',page_revision,'page',_page,'page_size',20,'total',(select count(*) from candidates),
  'rows',coalesce((select jsonb_agg(to_jsonb(p) order by id) from page_rows p),'[]'),
  'payment',jsonb_build_object('id',payment.id,'payable_id',payment.payable_id,'bank_account_id',payment.bank_account_id,
   'account_name',(select a.name from public.bank_accounts a where a.tenant_id=_tenant and a.id=payment.bank_account_id),
   'supplier_name',payable.supplier_name,'paid_on',paid_day,'amount_cents',amount::text,'bank_transaction_id',payment.bank_transaction_id,'driver_id',payable.driver_id),
  'eligible',issue is null,'issue',issue,'active_link',active_link,'history_total',(select count(*) from history),
  'history',coalesce((select jsonb_agg(to_jsonb(h) order by created_at desc,id desc) from history_page h),'[]')) into result;
 return result;
end$$;
revoke all on function finance_private.legacy_payable_association(uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.legacy_payable_association(uuid,uuid,integer,text) to authenticated;
