-- Protect the dedicated evidence namespace even from broad legacy policies.
create function finance_private.can_read_receipt(_path text) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if split_part(_path,'/',1) !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false;end if;
 return finance_private.can_access(split_part(_path,'/',1)::uuid);
end;$$;
revoke all on function finance_private.can_read_receipt(text) from public,anon,authenticated,service_role;
grant execute on function finance_private.can_read_receipt(text) to anon,authenticated;
grant usage on schema finance_private to anon;
create policy finance_receipt_read on storage.objects as restrictive for select to anon,authenticated
 using(bucket_id<>'receipts' or split_part(name,'/',2)<>'finance-batches' or finance_private.can_read_receipt(name));
create policy finance_receipt_no_insert on storage.objects as restrictive for insert to anon,authenticated
 with check(bucket_id<>'receipts' or split_part(name,'/',2)<>'finance-batches');
create policy finance_receipt_no_update on storage.objects as restrictive for update to anon,authenticated
 using(bucket_id<>'receipts' or split_part(name,'/',2)<>'finance-batches')
 with check(bucket_id<>'receipts' or split_part(name,'/',2)<>'finance-batches');
create policy finance_receipt_no_delete on storage.objects as restrictive for delete to anon,authenticated
 using(bucket_id<>'receipts' or split_part(name,'/',2)<>'finance-batches');

create function finance_private.preserve_receipt_object() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.bucket_id='receipts' and (split_part(old.name,'/',2)='finance-batches'
   or exists(select 1 from public.finance_expense_items where receipt_path=old.name)
   or exists(select 1 from public.finance_unloading_charges where receipt_path=old.name)
   or exists(select 1 from public.finance_movements where receipt_path=old.name)) then
   raise exception 'finance_receipt_retention_required' using errcode='23514';
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end;$$;
revoke all on function finance_private.preserve_receipt_object() from public,anon,authenticated,service_role;
create trigger preserve_finance_receipt_object before update or delete on storage.objects
 for each row execute function finance_private.preserve_receipt_object();
create index finance_expense_receipt_path on public.finance_expense_items(receipt_path) where receipt_path is not null;
create index finance_unloading_receipt_path on public.finance_unloading_charges(receipt_path);
create index finance_movement_receipt_path on public.finance_movements(receipt_path) where receipt_path is not null;

alter table public.finance_movements add column receipt_evidence jsonb;
alter table public.finance_expense_items add column receipt_evidence jsonb;
alter table public.finance_unloading_charges add column receipt_evidence jsonb;
create function finance_private.verify_receipt_object() returns trigger
language plpgsql security definer set search_path='' as $$
declare evidence jsonb;
begin
 if new.receipt_path is null then return new;end if;
 if new.receipt_path not like new.tenant_id::text||'/%' or new.receipt_path like '%..%' then
   raise exception 'finance_invalid_receipt_scope' using errcode='22023';end if;
 select to_jsonb(o) into evidence from storage.objects o where bucket_id='receipts' and name=new.receipt_path for share nowait;
 if evidence is null then raise exception 'finance_receipt_not_found' using errcode='22023';end if;
 if coalesce(evidence#>>'{metadata,mimetype}','') not in('application/pdf','image/jpeg','image/png','image/webp')
   or coalesce(evidence#>>'{metadata,size}','') !~ '^[1-9][0-9]{0,7}$' then
   raise exception 'finance_invalid_receipt_metadata' using errcode='22023';end if;
 new.receipt_evidence:=jsonb_build_object('object_id',evidence->>'id','bucket','receipts','path',new.receipt_path,
   'metadata',evidence->'metadata','created_at',evidence->>'created_at','verified_at',clock_timestamp());
 return new;
end;$$;
revoke all on function finance_private.verify_receipt_object() from public,anon,authenticated,service_role;
create trigger verify_finance_movement_receipt before insert on public.finance_movements for each row execute function finance_private.verify_receipt_object();
create trigger verify_finance_expense_receipt before insert on public.finance_expense_items for each row execute function finance_private.verify_receipt_object();
create trigger verify_finance_unloading_receipt before insert on public.finance_unloading_charges for each row execute function finance_private.verify_receipt_object();
