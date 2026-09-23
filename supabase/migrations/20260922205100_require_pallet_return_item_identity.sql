create or replace function public.require_pallet_return_item_identity()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if nullif(btrim(new.pallet_type_code), '') is null
    or nullif(btrim(new.pallet_type_name), '') is null then
    raise exception 'pallet_return_item_identity_required' using errcode = '22023';
  end if;
  return new;
end
$function$;

create trigger require_pallet_return_item_identity
before insert or update of pallet_type_code,pallet_type_name on public.pallet_return_items
for each row execute function public.require_pallet_return_item_identity();
