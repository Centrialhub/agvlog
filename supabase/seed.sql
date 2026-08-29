-- Deterministic local/E2E data only. Supabase only executes this file during
-- an explicit local `supabase db reset`; production migration commands do not.
-- All identities use reserved .invalid addresses and fixed non-production IDs.

begin;

-- The production invite-only trigger is intentionally preserved in migrations.
-- Local reset is the one narrow exception because a seed has no pre-existing
-- inviter. Re-enable it immediately after inserting the fixture identities.
set local session_replication_role = replica;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new,
  is_sso_user,
  is_anonymous
)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@agvlog-e2e.invalid', crypt(encode(gen_random_bytes(24), 'hex'), gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Owner E2E"}', now(), now(), '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'operator@agvlog-e2e.invalid', crypt(encode(gen_random_bytes(24), 'hex'), gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Operator E2E"}', now(), now(), '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'driver@agvlog-e2e.invalid', crypt(encode(gen_random_bytes(24), 'hex'), gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Driver E2E"}', now(), now(), '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'client@agvlog-e2e.invalid', crypt(encode(gen_random_bytes(24), 'hex'), gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Client E2E"}', now(), now(), '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'tenant-b@agvlog-e2e.invalid', crypt(encode(gen_random_bytes(24), 'hex'), gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Tenant B E2E"}', now(), now(), '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'admin@agvlog-e2e.invalid', crypt(encode(gen_random_bytes(24), 'hex'), gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Admin E2E"}', now(), now(), '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'multi-operator@agvlog-e2e.invalid', crypt(encode(gen_random_bytes(24), 'hex'), gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Multi Operator E2E"}', now(), now(), '', '', '', '', false, false)
on conflict (id) do update
set email = excluded.email,
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = excluded.email_confirmed_at,
    raw_app_meta_data = excluded.raw_app_meta_data,
    raw_user_meta_data = excluded.raw_user_meta_data,
    updated_at = now();

set local session_replication_role = origin;

insert into auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  user_row.id,
  user_row.id,
  user_row.id::text,
  jsonb_build_object('sub', user_row.id::text, 'email', user_row.email, 'email_verified', true),
  'email',
  now(),
  now(),
  now()
from auth.users user_row
where user_row.id in (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000007'
)
on conflict (provider_id, provider) do update
set identity_data = excluded.identity_data,
    updated_at = now();

insert into public.profiles (id, full_name)
values
  ('10000000-0000-4000-8000-000000000001', 'Owner E2E'),
  ('10000000-0000-4000-8000-000000000002', 'Operator E2E'),
  ('10000000-0000-4000-8000-000000000003', 'Driver E2E'),
  ('10000000-0000-4000-8000-000000000004', 'Client E2E'),
  ('10000000-0000-4000-8000-000000000005', 'Tenant B E2E'),
  ('10000000-0000-4000-8000-000000000006', 'Admin E2E'),
  ('10000000-0000-4000-8000-000000000007', 'Multi Operator E2E')
on conflict (id) do update set full_name = excluded.full_name, updated_at = now();

insert into public.tenants (id, name, plan_key, timezone, settings)
values
  ('20000000-0000-4000-8000-000000000001', 'AGVLOG E2E A', 'enterprise', 'America/Sao_Paulo', '{"fixture":true}'),
  ('20000000-0000-4000-8000-000000000002', 'AGVLOG E2E B', 'enterprise', 'America/Sao_Paulo', '{"fixture":true}')
on conflict (id) do update set name = excluded.name, settings = excluded.settings, updated_at = now();

insert into public.tenant_memberships (id, tenant_id, user_id, role, active)
values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner', true),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'operator', true),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'driver', true),
  ('30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000005', 'operator', true),
  ('30000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006', 'admin', true),
  ('30000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000007', 'operator', true),
  ('30000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000007', 'operator', true)
on conflict (tenant_id, user_id) do update set role = excluded.role, active = true, updated_at = now();

insert into public.clients (id, tenant_id, company_name, trade_name, tax_id, email, address_city, address_state)
values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Cliente Fixture A', 'Cliente A', '11111111000191', 'client-a@agvlog-e2e.invalid', 'Montes Claros', 'MG'),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Cliente Fixture B', 'Cliente B', '22222222000191', 'client-b@agvlog-e2e.invalid', 'Belo Horizonte', 'MG')
on conflict (id) do update set company_name = excluded.company_name, updated_at = now();

-- More than one server page for list-volume and search contracts.
insert into public.clients (
  id, tenant_id, company_name, trade_name, tax_id, email,
  address_city, address_state, is_client, is_supplier
)
select
  md5('agvlog-e2e-client-a-' || series.number::text)::uuid,
  '20000000-0000-4000-8000-000000000001',
  'Cliente Massa A ' || lpad(series.number::text, 3, '0'),
  'Massa A ' || lpad(series.number::text, 3, '0'),
  '99000000' || lpad(series.number::text, 6, '0'),
  'client-mass-' || series.number::text || '@agvlog-e2e.invalid',
  case when series.number % 2 = 0 then 'Janaúba' else 'Montes Claros' end,
  'MG',
  true,
  series.number % 10 = 0
from generate_series(1, 125) as series(number)
on conflict (id) do update
set company_name = excluded.company_name,
    is_supplier = excluded.is_supplier,
    updated_at = now();

insert into public.client_portal_access (
  id,
  tenant_id,
  user_id,
  client_id,
  access_type,
  can_view_financial,
  can_download_documents,
  can_open_occurrences,
  can_request_pickup,
  can_view_vehicle_live,
  can_view_driver_contact,
  active
)
values (
  '41000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000004',
  '40000000-0000-4000-8000-000000000001',
  'full', true, true, true, true, true, false, true
)
on conflict (id) do update set active = true, updated_at = now();

insert into public.vehicles (id, tenant_id, plate, nickname, type, active, tags, blocked, in_maintenance)
values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'E2E1A01', 'Caminhão E2E A', 'truck', true, '["fixture"]', false, false),
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'E2E2B02', 'Caminhão E2E B', 'truck', true, '["fixture"]', false, false)
on conflict (id) do update set plate = excluded.plate, updated_at = now();

insert into public.vehicles (
  id, tenant_id, plate, nickname, type, active, tags, blocked, in_maintenance
)
select
  md5('agvlog-e2e-vehicle-a-' || series.number::text)::uuid,
  '20000000-0000-4000-8000-000000000001',
  'T' || lpad(series.number::text, 6, '0'),
  'Veículo Massa A ' || lpad(series.number::text, 3, '0'),
  'truck', true, '["fixture","volume"]', false, false
from generate_series(1, 125) as series(number)
on conflict (id) do update
set nickname = excluded.nickname,
    updated_at = now();

insert into public.operational_routes (
  id, tenant_id, name, description, classification, destinations,
  region_name, active, periodicity_default
)
select
  md5('agvlog-e2e-route-a-' || series.number::text)::uuid,
  '20000000-0000-4000-8000-000000000001',
  'Rota Massa A ' || lpad(series.number::text, 3, '0'),
  'Rota determinística para validação de volume',
  'regional',
  jsonb_build_array(jsonb_build_object('city', 'Janaúba', 'state', 'MG', 'order', 1)),
  'Norte de Minas', true, 'weekly'
from generate_series(1, 125) as series(number)
on conflict (id) do update
set name = excluded.name,
    updated_at = now();

insert into public.drivers (id, tenant_id, user_id, name, email, driver_type, current_vehicle_id, active)
values
  ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'Motorista E2E A', 'driver@agvlog-e2e.invalid', 'proprio', '50000000-0000-4000-8000-000000000001', true),
  ('60000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', null, 'Motorista E2E B', 'driver-b@agvlog-e2e.invalid', 'proprio', '50000000-0000-4000-8000-000000000002', true)
on conflict (id) do update set name = excluded.name, updated_at = now();

update public.vehicles
set current_driver_id = case id
  when '50000000-0000-4000-8000-000000000001' then '60000000-0000-4000-8000-000000000001'::uuid
  else '60000000-0000-4000-8000-000000000002'::uuid
end
where id in ('50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002');

insert into public.loads (
  id, tenant_id, load_number, vehicle_id, driver_id, origin, destination,
  status, operation_type, load_date, gross_cargo_value, freight_amount
)
values
  ('70000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'E2E-LOAD-A-001', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'Montes Claros/MG', 'Janaúba/MG', 'planned', 'frota', current_date, 12500, 850),
  ('70000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'E2E-LOAD-B-001', '50000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', 'Belo Horizonte/MG', 'Contagem/MG', 'planned', 'frota', current_date, 22000, 1200)
on conflict (id) do update set load_number = excluded.load_number, updated_at = now();

-- More than one server page, plus multiple loads assigned to the same driver.
insert into public.loads (
  id, tenant_id, load_number, vehicle_id, driver_id, origin, destination,
  status, operation_type, load_date, gross_cargo_value, freight_amount
)
select
  md5('agvlog-e2e-load-a-' || series.number::text)::uuid,
  '20000000-0000-4000-8000-000000000001',
  'E2E-BULK-A-' || lpad(series.number::text, 3, '0'),
  '50000000-0000-4000-8000-000000000001',
  case when series.number <= 5 then '60000000-0000-4000-8000-000000000001'::uuid else null end,
  'Montes Claros/MG',
  case when series.number % 2 = 0 then 'Janaúba/MG' else 'Bocaiúva/MG' end,
  case when series.number % 5 = 0 then 'ready' else 'planned' end,
  'frota',
  current_date + (series.number % 14),
  1000 + series.number * 10,
  100 + series.number
from generate_series(1, 125) as series(number)
on conflict (tenant_id, load_number) do update
set status = excluded.status,
    updated_at = now();

insert into public.dispatch_trips (
  id, tenant_id, load_id, driver_id, vehicle_id, status, planned_start_at, planned_end_at
)
values
  ('80000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'planned', now() + interval '1 day', now() + interval '1 day 4 hours'),
  ('80000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', 'planned', now() + interval '1 day', now() + interval '1 day 3 hours')
on conflict (id) do update set status = excluded.status, updated_at = now();

insert into public.dispatch_trip_loads (id, tenant_id, dispatch_trip_id, load_id)
values
  ('81000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001'),
  ('81000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000002')
on conflict (id) do nothing;

insert into public.dispatch_stops (
  id, tenant_id, dispatch_trip_id, stop_order, destination, client_id,
  planned_arrival_at, status, latitude, longitude
)
values
  ('82000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', 1, 'Cliente Fixture A — Janaúba/MG', '40000000-0000-4000-8000-000000000001', now() + interval '1 day 2 hours', 'pending', -15.802, -43.313),
  ('82000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000002', 1, 'Cliente Fixture B — Contagem/MG', '40000000-0000-4000-8000-000000000002', now() + interval '1 day 2 hours', 'pending', -19.932, -44.053)
on conflict (id) do update set destination = excluded.destination, updated_at = now();

insert into public.fiscal_documents (
  id, tenant_id, document_type, invoice_number, access_key, client_id, recipient,
  issue_date, load_id, pallet_count, weight_kg, value, status,
  recipient_city, recipient_state, operation_type, delivery_meta
)
values (
  '90000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'inbound', 'E2E-NF-001', '31260811111111000191550010000000011000000010',
  '40000000-0000-4000-8000-000000000001', 'Cliente Fixture A', current_date,
  '70000000-0000-4000-8000-000000000001', 2, 450, 12500, 'delivered',
  'Janaúba', 'MG', 'frota', '{"fixture":true}'
)
on conflict (id) do update set status = excluded.status, updated_at = now();

insert into public.fiscal_documents (
  id, tenant_id, document_type, invoice_number, client_id, remitter, recipient,
  issue_date, load_id, pallet_count, weight_kg, value, status,
  recipient_city, recipient_state, operation_type, delivery_meta
)
select
  md5('agvlog-e2e-fiscal-document-a-' || series.number::text)::uuid,
  '20000000-0000-4000-8000-000000000001',
  'inbound',
  'E2E-MASS-NF-' || lpad(series.number::text, 3, '0'),
  '40000000-0000-4000-8000-000000000001',
  'Remetente Massa E2E',
  'Cliente Fixture A',
  current_date - (series.number % 30),
  case when series.number <= 5 then '70000000-0000-4000-8000-000000000001'::uuid else null end,
  1 + (series.number % 4),
  100 + series.number,
  1000 + series.number * 10,
  case when series.number % 7 = 0 then 'pending' else 'confirmed' end,
  case when series.number % 2 = 0 then 'Janaúba' else 'Montes Claros' end,
  'MG', 'frota', '{"fixture":true,"volume":true}'
from generate_series(1, 125) as series(number)
on conflict (id) do update
set status = excluded.status,
    updated_at = now();

insert into public.dispatch_stop_documents (
  id, tenant_id, dispatch_stop_id, fiscal_document_id, load_id
)
values (
  '90500000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001'
)
on conflict (id) do nothing;

insert into public.proof_of_delivery (
  id, tenant_id, fiscal_document_id, load_id, dispatch_trip_id, dispatch_stop_id,
  proof_type, status, receiver_name, received_at, validated_at, metadata,
  content_hash, photo_url
)
values (
  '91000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  'pod_photo', 'validated', 'Recebedor Fixture', now(), now(), '{"fixture":true}',
  encode(digest('agvlog-e2e-pod', 'sha256'), 'hex'), null
)
on conflict (id) do update set status = excluded.status, updated_at = now();

insert into public.delivery_occurrences (
  id, tenant_id, fiscal_document_id, load_id, client_id, driver_id,
  occurrence_number, invoice_number, customer_name, city, state,
  occurrence_type, occurrence_reason, occurrence_description,
  occurrence_date, status, metadata, created_at, updated_at
) values (
  '92000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  'E2E-OCC-001', 'E2E-NF-001', 'Cliente Fixture A', 'Janaúba', 'MG',
  'avaria', 'Embalagem', 'Ocorrência determinística para smoke de rota dinâmica',
  current_date, 'open', '{"fixture":true}'::jsonb, now(), now()
)
on conflict (id) do update set updated_at = excluded.updated_at;

insert into public.operational_events (
  id, tenant_id, load_id, vehicle_id, driver_id, client_id,
  event_type, severity, description, created_at, updated_at,
  visible_to_client, client_action_required, client_opened,
  dispatch_trip_id, dispatch_stop_id, fiscal_document_id, payload
) values (
  '93000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'occurrence', 'warning', 'Evento determinístico para detalhe do motorista',
  now(), now(), true, false, false,
  '80000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001',
  '{"fixture":true,"event_subtype":"avaria"}'::jsonb
)
on conflict (id) do update set updated_at = excluded.updated_at;

-- Integration paths remain fail-closed in every fixture tenant.
update public.tenant_feature_policy
set enabled = false,
    notes = 'E2E fixture: disabled by default',
    updated_at = now(),
    updated_by = null
where tenant_id in (
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002'
)
and feature_key in ('ssx_enabled', 'fiscal_enabled', 'ssx_kill_switch', 'fiscal_kill_switch');

commit;
