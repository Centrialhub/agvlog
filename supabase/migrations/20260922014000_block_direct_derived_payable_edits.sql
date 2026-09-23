drop policy if exists payables_direct_manual_update on public.payables;
create policy payables_direct_manual_update on public.payables as restrictive for update to authenticated
using(source_table is null and source_id is null)
with check(source_table is null and source_id is null);

comment on policy payables_direct_manual_update on public.payables is
  'Browser row updates are limited to standalone titles; derived titles change through their canonical source commands.';
