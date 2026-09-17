with existing_numbers as (
  select
    maintenance_order.tenant_id,
    max(split_part(maintenance_order.order_number,'-',3)::bigint) as highest_number
  from public.maintenance_orders maintenance_order
  where maintenance_order.order_number ~ '^OS-[0-9]{4}-[0-9]{1,18}$'
  group by maintenance_order.tenant_id
)
insert into finance_private.maintenance_order_sequences(tenant_id,next_number)
select tenant_id,highest_number+1
from existing_numbers
where highest_number < 9223372036854775807
on conflict(tenant_id) do update
set next_number=greatest(
  finance_private.maintenance_order_sequences.next_number,
  excluded.next_number
);

comment on table finance_private.maintenance_order_sequences is
  'Next maintenance order suffix per tenant, initialized past all canonical OS numbers already stored.';
