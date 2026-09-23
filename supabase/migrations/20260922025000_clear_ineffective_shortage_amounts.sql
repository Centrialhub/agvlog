create or replace function private.clear_ineffective_shortage_amounts_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.status in ('cancelled','not_shortage') then
    new.amount_to_charge:=0;
    new.amount_written_off:=0;
    new.amount_reimbursed:=0;
  end if;
  return new;
end $$;

revoke all on function private.clear_ineffective_shortage_amounts_v1()
  from public,anon,authenticated,service_role;
drop trigger if exists clear_ineffective_shortage_amounts on public.merchandise_shortage_cases;
create trigger clear_ineffective_shortage_amounts
before insert or update of status,amount_to_charge,amount_written_off,amount_reimbursed
on public.merchandise_shortage_cases
for each row execute function private.clear_ineffective_shortage_amounts_v1();

update public.merchandise_shortage_cases
set amount_to_charge=0,amount_written_off=0,amount_reimbursed=0
where status in ('cancelled','not_shortage')
  and (coalesce(amount_to_charge,0)<>0 or coalesce(amount_written_off,0)<>0 or coalesce(amount_reimbursed,0)<>0);
