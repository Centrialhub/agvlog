-- Raw rows and historical reservations remain intact. Only new use is prohibited.
create function finance_private.movement_is_active(_tenant uuid,_movement uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.finance_movements m where m.tenant_id=_tenant and m.id=_movement
  and not exists(select 1 from public.finance_movement_voids v where v.tenant_id=m.tenant_id and v.movement_id=m.id));
$$;
create function finance_private.lock_active_movement_use(_tenant uuid) returns void language plpgsql security definer set search_path='' as $$begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if not pg_try_advisory_xact_lock(hashtextextended(_tenant::text||':finance',0)) then raise exception 'finance_movement_use_busy' using errcode='40001';end if;
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
end$$;
create function finance_private.assert_active_movement_reference(_tenant uuid,_movement uuid) returns void language plpgsql security definer set search_path='' as $$begin
 perform finance_private.lock_active_movement_use(_tenant);
 if not exists(select 1 from public.finance_movements where tenant_id=_tenant and id=_movement) then raise exception 'finance_movement_reference_invalid' using errcode='23514';end if;
 if not finance_private.movement_is_active(_tenant,_movement) then raise exception 'finance_movement_voided' using errcode='23514';end if;
end$$;
-- Capacity used is historical composition. Do not rewrite its totals or payment activity.
create function finance_private.available_movement_cents(_tenant uuid,_movement uuid,_direction text) returns numeric language plpgsql stable security definer set search_path='' as $$
declare m public.finance_movements%rowtype;used numeric;begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _direction is null or _direction not in('in','out') then raise exception 'finance_invalid_direction' using errcode='22023';end if;
 select * into m from public.finance_movements where tenant_id=_tenant and id=_movement;
 if not found or m.direction<>_direction or m.nature='transfer' or not finance_private.movement_is_active(_tenant,_movement) then return 0;end if;
 if _direction='out' then used:=finance_private.movement_used_cents(_tenant,_movement);else used:=finance_private.receipt_movement_used_cents(_tenant,_movement);end if;
 if used is null or used::text in('NaN','Infinity','-Infinity') or used<0 or used<>trunc(used) or used>m.amount_cents then raise exception 'finance_movement_capacity_inconsistent' using errcode='23514';end if;
 return m.amount_cents-used;
end$$;
revoke all on function finance_private.movement_is_active(uuid,uuid),finance_private.lock_active_movement_use(uuid),finance_private.assert_active_movement_reference(uuid,uuid),finance_private.available_movement_cents(uuid,uuid,text) from public,anon,authenticated,service_role;
create function finance_private.guard_active_financial_movement_reference() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='UPDATE' then perform finance_private.assert_active_movement_reference(old.tenant_id,old.movement_id);end if;
 perform finance_private.assert_active_movement_reference(new.tenant_id,new.movement_id);return new;
end$$;
revoke all on function finance_private.guard_active_financial_movement_reference() from public,anon,authenticated,service_role;
do $$declare name text;begin foreach name in array array['finance_expense_allocations','finance_payable_movement_links','finance_settlement_movement_links','finance_receivable_movement_links','finance_legacy_receipt_movement_links'] loop
 -- Sort before existing row guards which may take blocking advisory locks.
 execute format('create trigger a_finance_active_movement_reference before insert or update on public.%I for each row execute function finance_private.guard_active_financial_movement_reference()',name);
end loop;end$$;
create function finance_private.guard_payment_active_movement_references() returns trigger language plpgsql security definer set search_path='' as $$
declare data jsonb;prior_data jsonb;payment uuid;tenant uuid;movement uuid;begin
 data:=to_jsonb(new);if tg_op='UPDATE' then prior_data:=to_jsonb(old);end if;
 for tenant,payment in select distinct x.tenant,x.payment from (values ((data->>'tenant_id')::uuid,(data->>'id')::uuid),((prior_data->>'tenant_id')::uuid,(prior_data->>'id')::uuid)) x(tenant,payment) where x.tenant is not null loop
  perform finance_private.lock_active_movement_use(tenant);
  if tg_table_name='payables_payments' then
   for movement in select l.movement_id from public.finance_payable_movement_links l where l.tenant_id=tenant and l.payment_id=payment loop perform finance_private.assert_active_movement_reference(tenant,movement);end loop;
  elsif tg_table_name='driver_settlement_payments' then
   for movement in select l.movement_id from public.finance_settlement_movement_links l where l.tenant_id=tenant and l.payment_id=payment loop perform finance_private.assert_active_movement_reference(tenant,movement);end loop;
  elsif tg_table_name='receivables_payments' then
   for movement in select l.movement_id from public.finance_receivable_movement_links l where l.tenant_id=tenant and l.payment_id=payment union select l.movement_id from public.finance_legacy_receipt_movement_links l where l.tenant_id=tenant and l.payment_id=payment loop perform finance_private.assert_active_movement_reference(tenant,movement);end loop;
  end if;
 end loop;
 -- A legacy bank-transaction alias can point to a different payment's movement.
 for movement,tenant in
  select distinct l.movement_id,l.tenant_id from public.finance_receivable_movement_links l
   where (l.tenant_id=(data->>'tenant_id')::uuid and l.bank_transaction_id=nullif(data->>'bank_transaction_id','')::uuid)
      or (l.tenant_id=(prior_data->>'tenant_id')::uuid and l.bank_transaction_id=nullif(prior_data->>'bank_transaction_id','')::uuid)
  union select l.movement_id,l.tenant_id from public.finance_payable_movement_links l join public.payables_payments p on p.tenant_id=l.tenant_id and p.id=l.payment_id
   where (p.tenant_id=(data->>'tenant_id')::uuid and p.bank_transaction_id=nullif(data->>'bank_transaction_id','')::uuid)
      or (p.tenant_id=(prior_data->>'tenant_id')::uuid and p.bank_transaction_id=nullif(prior_data->>'bank_transaction_id','')::uuid)
 loop perform finance_private.assert_active_movement_reference(tenant,movement);end loop;
 return new;
end$$;
revoke all on function finance_private.guard_payment_active_movement_references() from public,anon,authenticated,service_role;
do $$declare name text;begin foreach name in array array['payables_payments','driver_settlement_payments','receivables_payments'] loop
 execute format('create trigger a_finance_active_payment_reference before insert or update on public.%I for each row execute function finance_private.guard_payment_active_movement_references()',name);
 -- Payment precedes link in valid commands. Recheck the final transaction graph.
 execute format('create constraint trigger finance_active_payment_reference_final after insert or update on public.%I deferrable initially deferred for each row execute function finance_private.guard_payment_active_movement_references()',name);
end loop;end$$;
