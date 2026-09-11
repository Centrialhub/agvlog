-- Extend the verified cut without changing the previously rehearsed base migration.
create function finance_private.legacy_cut_settlement_evidence(_tenant uuid,_payment uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.driver_settlement_payments%rowtype;s public.driver_settlements%rowtype;l public.finance_settlement_movement_links%rowtype;m public.finance_movements%rowtype;n integer;used numeric;valid boolean:=false;
begin
 select * into p from public.driver_settlement_payments where tenant_id=_tenant and id=_payment;
 if not found then return jsonb_build_object('valid',false,'account_id',null,'movement_ids','[]'::jsonb);end if;
 select count(*) into n from public.finance_settlement_movement_links x where x.tenant_id=_tenant and x.payment_id=p.id and not exists(select 1 from public.finance_settlement_link_reversals r where r.tenant_id=_tenant and r.link_id=x.id);
 if n<>1 then return jsonb_build_object('valid',false,'account_id',null,'movement_ids','[]'::jsonb);end if;
 select * into l from public.finance_settlement_movement_links x where x.tenant_id=_tenant and x.payment_id=p.id and not exists(select 1 from public.finance_settlement_link_reversals r where r.tenant_id=_tenant and r.link_id=x.id);
 select * into s from public.driver_settlements where tenant_id=_tenant and id=p.settlement_id;
 select * into m from public.finance_movements where tenant_id=_tenant and id=l.movement_id;
 if not found then return jsonb_build_object('valid',false,'account_id',null,'movement_ids','[]'::jsonb);end if;
 select coalesce(sum(cents),0) into used from (
  select a.amount_cents cents from public.finance_expense_allocations a where a.tenant_id=_tenant and a.movement_id=m.id
  union all select a.amount_cents from public.finance_payable_movement_links a where a.tenant_id=_tenant and a.movement_id=m.id and not exists(select 1 from public.finance_payable_link_reversals r where r.tenant_id=_tenant and r.link_id=a.id)
  union all select a.amount_cents from public.finance_settlement_movement_links a where a.tenant_id=_tenant and a.movement_id=m.id and not exists(select 1 from public.finance_settlement_link_reversals r where r.tenant_id=_tenant and r.link_id=a.id)
 ) allocations;
 valid:=coalesce(s.id is not null and s.driver_id is not null and exists(select 1 from public.drivers where tenant_id=_tenant and id=s.driver_id) and l.settlement_id=p.settlement_id and m.driver_id=s.driver_id and m.direction='out' and m.nature<>'transfer'
  and p.amount>0 and p.amount*100=trunc(p.amount*100) and p.amount*100<=99999999999999 and l.amount_cents=p.amount*100
  and p.paid_at is not null and isfinite(p.paid_at) and m.occurred_on=(p.paid_at at time zone 'America/Sao_Paulo')::date
  and used<=m.amount_cents and exists(select 1 from public.bank_accounts where tenant_id=_tenant and id=m.bank_account_id),false);
 return jsonb_build_object('valid',valid,'account_id',case when valid then m.bank_account_id end,'movement_ids',case when valid then jsonb_build_array(m.id) else '[]'::jsonb end,'link_id',l.id,'reserved_cents',used::text);
end$$;
revoke all on function finance_private.legacy_cut_settlement_evidence(uuid,uuid) from public,anon,authenticated,service_role;
do $$declare body text;needle text;
begin
 select pg_get_functiondef('finance_private.legacy_cut_manifest(uuid,uuid,date,date)'::regprocedure) into body;
 needle:='classification text;table_name text;';if position(needle in body)=0 then raise exception 'finance_legacy_cut_declaration_contract_changed';end if;
 body:=replace(body,needle,'driver_map jsonb;classification text;table_name text;');
 needle:='''finance_receipt_allocation_corrections''] loop';if position(needle in body)=0 then raise exception 'finance_legacy_cut_evidence_contract_changed';end if;
 body:=replace(body,needle,'''finance_receipt_allocation_corrections'',''finance_expense_allocations'',''driver_settlements''] loop');
 needle:='   if account is not null and exists';if position(needle in body)=0 then raise exception 'finance_legacy_cut_account_contract_changed';end if;
 body:=replace(body,needle,$patch$   if table_name='driver_settlement_payments' then driver_map:=finance_private.legacy_cut_settlement_evidence(_tenant,(item->>'id')::uuid);account:=(driver_map->>'account_id')::uuid;end if;
   if account is not null and exists$patch$);
 needle:='   if valid then';if position(needle in body)=0 then raise exception 'finance_legacy_cut_classification_contract_changed';end if;
 body:=replace(body,needle,$patch$   if table_name='driver_settlement_payments' then valid:=coalesce((driver_map->>'valid')::boolean,false);movement_ids:=driver_map->'movement_ids';end if;
   if valid then$patch$);
 body:=replace(body,'''classifier_version'',''1''','''classifier_version'',''2''');execute body;
end$$;
