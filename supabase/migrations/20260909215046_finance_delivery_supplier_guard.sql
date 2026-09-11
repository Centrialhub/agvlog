-- New writes must preserve a single supplier per delivery. Existing mixed
-- deliveries are not rewritten; correcting them requires an explicit operation.
create function finance_private.lock_delivery_composition() returns trigger
language plpgsql security definer set search_path='' as $$
declare t uuid;
begin
 for t in select distinct x from unnest(array[
   case when tg_op<>'INSERT' then old.tenant_id end,
   case when tg_op<>'DELETE' then new.tenant_id end]) x where x is not null order by x
 loop
   perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 end loop;
 if tg_op='DELETE' then return old; end if;
 return new;
end;$$;
revoke all on function finance_private.lock_delivery_composition() from public,anon,authenticated,service_role;

create function finance_private.assert_delivery_supplier(_tenant uuid,_stop uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.dispatch_stop_documents d
   left join public.fiscal_documents f on f.id=d.fiscal_document_id and f.tenant_id=d.tenant_id
   left join public.dispatch_stops s on s.id=d.dispatch_stop_id and s.tenant_id=d.tenant_id
   where d.tenant_id=_tenant and d.dispatch_stop_id=_stop and (f.id is null or s.id is null)) then
   raise exception 'finance_delivery_document_scope_invalid' using errcode='23514';
 end if;
 if (select count(distinct f.supplier_id) from public.dispatch_stop_documents d
   join public.fiscal_documents f on f.id=d.fiscal_document_id and f.tenant_id=d.tenant_id
   where d.tenant_id=_tenant and d.dispatch_stop_id=_stop)>1 then
   raise exception 'finance_delivery_mixed_suppliers' using errcode='23514';
 end if;
end;$$;
revoke all on function finance_private.assert_delivery_supplier(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.validate_delivery_supplier() returns trigger
language plpgsql security definer set search_path='' as $$
declare s record;
begin
 if tg_table_name='dispatch_stop_documents' then
   if tg_op<>'INSERT' then perform finance_private.assert_delivery_supplier(old.tenant_id,old.dispatch_stop_id);end if;
   if tg_op<>'DELETE' then perform finance_private.assert_delivery_supplier(new.tenant_id,new.dispatch_stop_id);end if;
 else
   for s in select distinct d.tenant_id,d.dispatch_stop_id from public.dispatch_stop_documents d
     where d.fiscal_document_id=new.id
   loop perform finance_private.assert_delivery_supplier(s.tenant_id,s.dispatch_stop_id);end loop;
 end if;
 return null;
end;$$;
revoke all on function finance_private.validate_delivery_supplier() from public,anon,authenticated,service_role;

create trigger finance_lock_delivery_composition before insert or update or delete on public.dispatch_stop_documents
 for each row execute function finance_private.lock_delivery_composition();
create trigger finance_lock_document_supplier before update of supplier_id,tenant_id on public.fiscal_documents
 for each row execute function finance_private.lock_delivery_composition();
create constraint trigger finance_validate_delivery_supplier after insert or update or delete on public.dispatch_stop_documents
 deferrable initially deferred for each row execute function finance_private.validate_delivery_supplier();
create constraint trigger finance_validate_document_supplier after update of supplier_id,tenant_id on public.fiscal_documents
 deferrable initially deferred for each row execute function finance_private.validate_delivery_supplier();
