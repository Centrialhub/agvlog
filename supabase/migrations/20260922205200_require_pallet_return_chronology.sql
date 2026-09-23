create or replace function public.require_pallet_return_chronology()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.returned_at is not null and new.returned_at < new.issue_date then
    raise exception 'pallet_return_before_issue' using errcode = '22023';
  end if;
  return new;
end
$function$;

create trigger require_pallet_return_chronology
before insert or update of issue_date,returned_at on public.pallet_return_protocols
for each row execute function public.require_pallet_return_chronology();
