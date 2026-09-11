-- Operational delivery proofs share the bucket and retain their own policies.
create function finance_private.financial_receipt_path(_path text) returns boolean
language sql immutable set search_path='' as $$select split_part(_path,'/',2) in('finance-batches','expense-receipts','payable-payments','receivable-payments','payables');$$;
revoke all on function finance_private.financial_receipt_path(text) from public,anon,authenticated,service_role;
grant execute on function finance_private.financial_receipt_path(text) to anon,authenticated;
create policy finance_legacy_receipt_read on storage.objects as restrictive for select to anon,authenticated
 using(bucket_id<>'receipts' or not finance_private.financial_receipt_path(name) or finance_private.can_read_receipt(name));
create policy finance_legacy_receipt_insert on storage.objects as restrictive for insert to anon,authenticated
 with check(bucket_id<>'receipts' or not finance_private.financial_receipt_path(name));
create policy finance_legacy_receipt_update on storage.objects as restrictive for update to anon,authenticated
 using(bucket_id<>'receipts' or not finance_private.financial_receipt_path(name))
 with check(bucket_id<>'receipts' or not finance_private.financial_receipt_path(name));
create policy finance_legacy_receipt_delete on storage.objects as restrictive for delete to anon,authenticated
 using(bucket_id<>'receipts' or not finance_private.financial_receipt_path(name));
