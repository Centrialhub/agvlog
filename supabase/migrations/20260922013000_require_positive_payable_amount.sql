alter table public.payables drop constraint if exists payables_amount_positive;
alter table public.payables add constraint payables_amount_positive check(amount>0) not valid;

do $validation$
begin
  if not exists(select 1 from public.payables where amount<=0) then
    alter table public.payables validate constraint payables_amount_positive;
  end if;
end;$validation$;
