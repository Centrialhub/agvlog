create temporary table pallet_type_code_duplicates on commit drop as
select id as duplicate_id, keeper_id
from (
  select id,first_value(id) over(
    partition by tenant_id,upper(btrim(code))
    order by created_at,id
  ) as keeper_id
  from public.pallet_types
) ranked
where id<>keeper_id;

update public.pallet_return_items item
set pallet_type_id=duplicate.keeper_id
from pallet_type_code_duplicates duplicate
where item.pallet_type_id=duplicate.duplicate_id;

delete from public.pallet_types pallet_type
using pallet_type_code_duplicates duplicate
where pallet_type.id=duplicate.duplicate_id;

update public.pallet_types
set code=upper(btrim(code))
where code is distinct from upper(btrim(code));

drop index if exists public.ux_pallet_types_tenant_code;
create unique index ux_pallet_types_tenant_code
  on public.pallet_types(tenant_id,upper(btrim(code)));
