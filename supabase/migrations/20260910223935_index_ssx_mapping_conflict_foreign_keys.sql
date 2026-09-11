set local lock_timeout = '3s';
set local statement_timeout = '30s';

create index if not exists idx_ssx_mapping_conflicts_account_fk
  on public.ssx_mapping_conflicts (integration_account_id);

create index if not exists idx_ssx_mapping_conflicts_provider_unit_fk
  on public.ssx_mapping_conflicts (provider_unit_id);

create index if not exists idx_ssx_mapping_conflicts_linked_vehicle_fk
  on public.ssx_mapping_conflicts (linked_vehicle_id)
  where linked_vehicle_id is not null;

create index if not exists idx_ssx_mapping_conflicts_resolved_by_fk
  on public.ssx_mapping_conflicts (resolved_by)
  where resolved_by is not null;

create index if not exists idx_ssx_mapping_conflicts_resolved_vehicle_fk
  on public.ssx_mapping_conflicts (resolved_vehicle_id)
  where resolved_vehicle_id is not null;
