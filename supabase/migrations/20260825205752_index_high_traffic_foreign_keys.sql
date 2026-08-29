-- Cover foreign keys used by the fiscal, load and telemetry hot paths.
create index if not exists idx_fiscal_documents_deleted_by_fk
  on public.fiscal_documents (deleted_by);

create index if not exists idx_telemetry_observations_vehicle_id
  on public.telemetry_observations (vehicle_id);

create index if not exists idx_load_items_fiscal_document_id
  on public.load_items (fiscal_document_id);

create index if not exists idx_load_items_load_id
  on public.load_items (load_id);

create index if not exists idx_load_items_order_id
  on public.load_items (order_id);

create index if not exists idx_dispatch_stop_documents_load_id
  on public.dispatch_stop_documents (load_id);

create index if not exists idx_vehicles_state_last_position_id
  on public.vehicles_state (last_position_id);

create index if not exists idx_clients_provider_person_integration_account_id
  on public.clients (provider_person_integration_account_id);

create index if not exists idx_positions_last_vehicle_id
  on public.positions_last (vehicle_id);

create index if not exists idx_vehicle_processing_queue_vehicle_id
  on public.vehicle_processing_queue (vehicle_id);
