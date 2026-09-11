-- Browser declarations belong in finance_movements. Bank rows are written only
-- by the scoped import/compatibility commands, never direct client DML.
revoke insert,update,delete,truncate,references,trigger on public.bank_transactions from public,anon,authenticated;
create policy finance_bank_no_direct_insert on public.bank_transactions as restrictive for insert to authenticated with check(false);
create policy finance_bank_no_direct_update on public.bank_transactions as restrictive for update to authenticated using(false) with check(false);
create policy finance_bank_no_direct_delete on public.bank_transactions as restrictive for delete to authenticated using(false);
