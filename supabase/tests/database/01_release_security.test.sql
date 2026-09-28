begin;

-- Every request context is transaction-local, including any legacy scalar
-- claims inherited from the psql session. No test state survives the rollback.
set local request.headers = '{}';
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = '';
set local request.jwt.claims = '{}';

select plan(110);

select has_table('public', 'tenant_feature_policy', 'tenant capability policy exists');

select is(
  (select count(*)::integer from public.fiscal_documents
   where tenant_id in ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002')
     and status in ('delivered', 'partial_delivery', 'returned', 'refused', 'failed', 'not_delivered')),
  0,
  'seed does not invent an unaudited terminal delivery result'
);
select ok(
  exists (select 1 from public.proof_of_delivery
    where id = '91000000-0000-4000-8000-000000000001'
      and status = 'pending' and is_active
      and receiver_name is null and received_at is null and validated_at is null
      and content_hash is null and storage_path is null and signature_url is null
      and photo_url is null and metadata = '{}'::jsonb),
  'seed creates an empty pending POD without fabricated received or validated evidence'
);

select is(
  (select count(*)::integer from public.tenant_feature_policy
   where tenant_id = '20000000-0000-4000-8000-000000000001'),
  4,
  'seed creates all four fail-closed integration flags'
);

select is(
  (select count(*)::integer from public.tenant_feature_policy
   where tenant_id = '20000000-0000-4000-8000-000000000001' and enabled),
  0,
  'seed does not enable an external integration'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'enforce_invite_only_before_auth_user_created'
      and tgenabled <> 'D'
  ),
  'invite-only auth trigger is enabled after seeding'
);

set local role service_role;
select lives_ok(
  $$select public.prepare_auth_invite(
    'invite-contract@agvlog-e2e.invalid',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'pgTAP-invite-contract-nonce-000000000001'
  )$$,
  'service role can prepare a short-lived invitation authorization'
);
reset role;

select lives_ok(
  $$insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000101',
    'authenticated', 'authenticated', 'invite-contract@agvlog-e2e.invalid',
    crypt(encode(gen_random_bytes(24), 'hex'), gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Invite Contract","agvlog_invite_nonce":"pgTAP-invite-contract-nonce-000000000001"}',
    now(), now(), '', '', '', '', false, false
  )$$,
  'auth.users accepts a prepared one-time invitation'
);

select is(
  (select count(*)::integer from private.auth_invite_authorizations
   where email = 'invite-contract@agvlog-e2e.invalid'),
  0,
  'accepted invitation consumes its authorization'
);

select ok(
  not coalesce(
    (select raw_user_meta_data ? 'agvlog_invite_nonce'
     from auth.users where id = '10000000-0000-4000-8000-000000000101'),
    true
  ),
  'accepted auth user does not retain the invitation nonce'
);

select throws_ok(
  $$insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000102',
    'authenticated', 'authenticated', 'invite-contract@agvlog-e2e.invalid',
    crypt(encode(gen_random_bytes(24), 'hex'), gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Invite Reuse","agvlog_invite_nonce":"pgTAP-invite-contract-nonce-000000000001"}',
    now(), now(), '', '', '', '', false, false
  )$$,
  '28000',
  'User creation requires an authorized invitation',
  'consumed invitation nonce cannot be reused'
);

select throws_ok(
  $$insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000103',
    'authenticated', 'authenticated', 'uninvited-contract@agvlog-e2e.invalid',
    crypt(encode(gen_random_bytes(24), 'hex'), gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Uninvited Contract"}',
    now(), now(), '', '', '', '', false, false
  )$$,
  '28000',
  'User creation requires an authorized invitation',
  'auth.users rejects an insertion without a prepared invitation'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.assert_tenant_integration_capability_v1(uuid,text)',
    'EXECUTE'
  ),
  'browser sessions cannot bypass the Edge capability guard'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.assert_tenant_integration_capability_v1(uuid,text)',
    'EXECUTE'
  ),
  'service role can enforce the Edge capability guard'
);

select ok(
  to_regprocedure('public.get_fiscal_document_summary_v1(uuid)') is not null,
  'server-side fiscal summary function exists'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.get_fiscal_document_summary_v1(uuid)',
    'EXECUTE'
  ),
  'anonymous sessions cannot execute the fiscal summary'
);

select ok(
  to_regprocedure('public.list_loads_page_v1(uuid,jsonb,integer,integer)') is not null,
  'server-side load pagination function exists'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.list_loads_page_v1(uuid,jsonb,integer,integer)',
    'EXECUTE'
  ),
  'anonymous sessions cannot execute load pagination'
);

select has_table('public', 'secure_upload_rate_events', 'upload rate ledger exists');

select is(
  (select relrowsecurity from pg_class where oid = 'public.secure_upload_rate_events'::regclass),
  true,
  'upload rate ledger has RLS enabled'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.consume_secure_upload_quota_v1(text,text,integer,integer)',
    'EXECUTE'
  ),
  'browser sessions cannot consume or bypass upload quota directly'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.consume_secure_upload_quota_v1(text,text,integer,integer)',
    'EXECUTE'
  ),
  'upload gateway service role can consume quota'
);

set local role service_role;
select results_eq(
  $$values
    (public.consume_secure_upload_quota_v1(repeat('a', 64), 'upload', 2, 60)),
    (public.consume_secure_upload_quota_v1(repeat('a', 64), 'upload', 2, 60)),
    (public.consume_secure_upload_quota_v1(repeat('a', 64), 'upload', 2, 60))$$,
  $$values (true), (true), (false)$$,
  'upload quota is consumed atomically and fails closed at the limit'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1","active_tenant_id":"20000000-0000-4000-8000-000000000001"}',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.clients),
  126,
  'tenant A operator sees only tenant A client rows'
);

select is(
  (select total_count from public.get_fiscal_document_summary_v1(
    '20000000-0000-4000-8000-000000000001'
  )),
  126::bigint,
  'server-side fiscal summary counts the visible tenant A volume'
);

select is(
  (select total_count from public.get_fiscal_document_summary_v1(
    '20000000-0000-4000-8000-000000000002'
  )),
  0::bigint,
  'server-side fiscal summary cannot expose a known tenant B identifier'
);

select is(
  (select total_count from public.list_loads_page_v1(
    '20000000-0000-4000-8000-000000000001', '{}'::jsonb, 25, 0
  )),
  126::bigint,
  'server-side load pagination counts tenant A volume'
);

select is(
  (select jsonb_array_length(items) from public.list_loads_page_v1(
    '20000000-0000-4000-8000-000000000001', '{}'::jsonb, 25, 0
  )),
  25,
  'server-side load pagination returns only the requested page'
);

select is(
  (select total_count from public.list_loads_page_v1(
    '20000000-0000-4000-8000-000000000001',
    '{"search":"E2E-BULK-A-125"}'::jsonb,
    25,
    0
  )),
  1::bigint,
  'server-side load search applies before counting and paging'
);

select is(
  (select total_count from public.list_loads_page_v1(
    '20000000-0000-4000-8000-000000000002', '{}'::jsonb, 25, 0
  )),
  0::bigint,
  'server-side load pagination cannot expose a known tenant B identifier'
);

select is(
  (select count(*)::integer from public.clients
   where id = '40000000-0000-4000-8000-000000000002'),
  0,
  'tenant A operator cannot read a known tenant B client ID'
);

select is(
  (select count(*)::integer from public.loads
   where id = '70000000-0000-4000-8000-000000000002'),
  0,
  'tenant A operator cannot read a known tenant B load ID'
);

select is(
  (select count(*)::integer from public.get_user_tenant_ids()),
  1,
  'operator access remains available at AAL1'
);

select results_eq(
  $$select ssx_effective, fiscal_effective
    from public.get_tenant_integration_capabilities_v1(
      '20000000-0000-4000-8000-000000000001'
    )$$,
  $$values (false, false)$$,
  'effective external capabilities are fail-closed'
);

select lives_ok(
  $$select public.transition_load_status_v1(
    '20000000-0000-4000-8000-000000000001',
    md5('agvlog-e2e-load-a-1')::uuid,
    'assembling',
    'pgTAP release contract'
  )$$,
  'operator can execute an allowed canonical load transition'
);

select is(
  (select status from public.loads where id = md5('agvlog-e2e-load-a-1')::uuid),
  'assembling',
  'allowed transition changes the canonical row'
);

select throws_ok(
  $$select public.transition_load_status_v1(
    '20000000-0000-4000-8000-000000000001',
    md5('agvlog-e2e-load-a-1')::uuid,
    'delivered',
    'invalid direct completion'
  )$$,
  'P0001',
  'invalid_load_status_transition: assembling -> delivered',
  'invalid load transition is rejected'
);

select ok(
  exists (
    select 1 from public.load_status_history
    where load_id = md5('agvlog-e2e-load-a-1')::uuid
      and old_value = 'planned'
      and new_value = 'assembling'
  ),
  'canonical transition writes status history'
);

select lives_ok(
  $$select public.upsert_load_item_v3(
    p_tenant_id => '20000000-0000-4000-8000-000000000001',
    p_load_id => md5('agvlog-e2e-load-a-1')::uuid,
    p_item_description => 'Item pgTAP',
    p_quantity => 2,
    p_weight_kg => 30,
    p_status => 'pending'
  )$$,
  'operator inserts a load item only through the audited RPC'
);

select is(
  (select total_weight_kg from public.loads where id = md5('agvlog-e2e-load-a-1')::uuid),
  30::numeric,
  'item mutation recalculates load totals'
);

select is(
  public.delete_load_item_v3(
    '20000000-0000-4000-8000-000000000001',
    (select id from public.load_items
     where load_id = md5('agvlog-e2e-load-a-1')::uuid
       and item_description = 'Item pgTAP')
  ),
  true,
  'canonical delete removes the fixture item'
);

select is(
  (select total_weight_kg from public.loads where id = md5('agvlog-e2e-load-a-1')::uuid),
  0::numeric,
  'delete recalculates totals back to zero'
);

select throws_ok(
  $$select public.transition_load_status_v1(
    '20000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000002',
    'assembling',
    'cross-tenant attempt'
  )$$,
  'P0001',
  'not_authorized',
  'operator cannot mutate a known load in tenant B'
);

select lives_ok(
  $$select public.plan_dispatch_trip_v3(
    '20000000-0000-4000-8000-000000000001',
    'pgtap-route-plan-contract-001',
    '60000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'Rota planejada pgTAP',
    array[md5('agvlog-e2e-load-a-2')::uuid],
    '[{"destination":"Janaúba/MG","client_id":"40000000-0000-4000-8000-000000000001","stop_order":1}]'::jsonb
  )$$,
  'operator plans a route and assigns driver, vehicle, load and stop atomically'
);

select is(
  (select driver_id from public.dispatch_trips where id = (
    select result_id from public.idempotency_keys
    where tenant_id = '20000000-0000-4000-8000-000000000001'
      and operation = 'plan_dispatch_trip'
      and idempotency_key = 'pgtap-route-plan-contract-001'
  )),
  '60000000-0000-4000-8000-000000000001'::uuid,
  'planned trip persists the assigned driver'
);

select is(
  (select status from public.loads where id = md5('agvlog-e2e-load-a-2')::uuid),
  'ready',
  'route planning moves the assigned load to ready'
);

select is(
  (select count(*)::integer from public.dispatch_stops where dispatch_trip_id = (
    select result_id from public.idempotency_keys
    where tenant_id = '20000000-0000-4000-8000-000000000001'
      and operation = 'plan_dispatch_trip'
      and idempotency_key = 'pgtap-route-plan-contract-001'
  )),
  1,
  'route planning persists its stop'
);

select ok(
  exists (
    select 1 from public.entity_state_audit_log
    where tenant_id = '20000000-0000-4000-8000-000000000001'
      and idempotency_key = 'pgtap-route-plan-contract-001'
      and entity_type = 'trip'
  ),
  'route planning writes its audit event'
);

select throws_ok(
  $$select public.transition_load_status_v1(
    '20000000-0000-4000-8000-000000000001',
    md5('agvlog-e2e-load-a-2')::uuid,
    'in_transit',
    'must wait for trip start'
  )$$,
  '23514',
  'trip_must_be_started_before_load',
  'operator cannot move a load to in_transit before its trip starts'
);

reset role;
-- Build a separate, rollback-only graph so this journey does not consume the
-- open document/POD reserved for browser tests. Fixture setup uses the test
-- administrator; every action below runs as the assigned driver.
set local request.jwt.claims = '{}';
insert into public.loads (id, tenant_id, load_number, driver_id, vehicle_id, status)
values ('70000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001',
  'PGTAP-JOURNEY-003', '60000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', 'planned');
insert into public.dispatch_trips (id, tenant_id, load_id, driver_id, vehicle_id, status)
values ('80000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', 'planned');
insert into public.dispatch_trip_loads (tenant_id, dispatch_trip_id, load_id)
values ('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000003',
  '70000000-0000-4000-8000-000000000003');
insert into public.dispatch_stops (id, tenant_id, dispatch_trip_id, stop_order,
  destination, client_id, status, latitude, longitude)
values ('82000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000003', 1, 'Entrega pgTAP',
  '40000000-0000-4000-8000-000000000001', 'pending', -15.802, -43.313);
insert into public.fiscal_documents (id, tenant_id, document_type, invoice_number,
  client_id, recipient, issue_date, load_id, pallet_count, weight_kg, value, status)
values ('90000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001',
  'inbound', 'PGTAP-NF-003', '40000000-0000-4000-8000-000000000001', 'Cliente Fixture A',
  current_date, '70000000-0000-4000-8000-000000000003', 2, 450, 12500, 'confirmed');
insert into public.dispatch_stop_documents (tenant_id, dispatch_stop_id, fiscal_document_id, load_id)
values ('20000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000003',
  '90000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003');

create temporary table release_test_trips (name text primary key, id uuid not null);
insert into release_test_trips values ('delivery', '80000000-0000-4000-8000-000000000003');
insert into release_test_trips
select 'planned', result_id from public.idempotency_keys
where tenant_id = '20000000-0000-4000-8000-000000000001'
  and operation = 'plan_dispatch_trip' and idempotency_key = 'pgtap-route-plan-contract-001';
grant select on release_test_trips to authenticated;
create temporary table release_delivery_request (details jsonb not null);
grant select, insert on release_delivery_request to authenticated;

-- Storage metadata is a SQL fixture, not an upload/download test. All rows and
-- evidence paths are synthetic and disappear with this transaction.
insert into storage.objects (bucket_id, name)
select 'receipts', '20000000-0000-4000-8000-000000000001/trip-cargo/' || trip.id || '/' || photo.name
from release_test_trips trip cross join (values ('loading.jpg'), ('tie-down.jpg')) photo(name);
insert into storage.objects (bucket_id, name)
select 'receipts', '20000000-0000-4000-8000-000000000001/deliveries/80000000-0000-4000-8000-000000000003/82000000-0000-4000-8000-000000000003/' || photo.name
from (values ('receipt/original/photo.jpg'), ('receipt/processed/scan.jpg'), ('signatures/signature.png')) photo(name);

-- Invoker helpers only assemble fixture payloads from the driver's RLS-visible
-- checks; they grant no application privileges and do not change app state.
create function pg_temp.release_cargo_payload(trip_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $fixture$
  select jsonb_build_object(
    'vehicle_checked', true, 'tie_down_confirmed', true,
    'seal_not_applicable_reason', 'Veículo de teste sem ponto de lacre',
    'documents', coalesce((select jsonb_agg(check_row.id order by check_row.id)
      from public.trip_cargo_document_checks check_row
      join public.trip_cargo_controls control on control.id = check_row.control_id
      where control.dispatch_trip_id = trip_id), '[]'::jsonb),
    'loads', coalesce((select jsonb_agg(jsonb_build_object('load_id', check_row.load_id,
      'volume_count', coalesce(check_row.expected_volume_count, 0),
      'pallet_count', coalesce(check_row.expected_pallet_count, 0),
      'weight_kg', coalesce(check_row.expected_weight_kg, 0)) order by check_row.load_id)
      from public.trip_cargo_load_checks check_row
      join public.trip_cargo_controls control on control.id = check_row.control_id
      where control.dispatch_trip_id = trip_id), '[]'::jsonb),
    'evidence', jsonb_build_array(
      jsonb_build_object('kind', 'loading', 'path', '20000000-0000-4000-8000-000000000001/trip-cargo/' || trip_id || '/loading.jpg'),
      jsonb_build_object('kind', 'tie_down', 'path', '20000000-0000-4000-8000-000000000001/trip-cargo/' || trip_id || '/tie-down.jpg')))
$fixture$;

select set_config('request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1","active_tenant_id":"20000000-0000-4000-8000-000000000001"}', true);
set local role authenticated;

select throws_ok(
  $$select public.driver_start_trip('80000000-0000-4000-8000-000000000003')$$,
  '23514', 'trip_cargo_departure_confirmation_required',
  'driver cannot start before the cargo departure gate');

select throws_ok(
  $$select public.driver_update_trip_cargo_v1('20000000-0000-4000-8000-000000000002',
    '80000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001',
    'accept', '{"vehicle_id":"50000000-0000-4000-8000-000000000002"}')$$,
  '42501', 'trip_cargo_not_authorized', 'driver cannot accept cargo in another tenant');

select is(public.driver_update_trip_cargo_v1('20000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002',
  'accept', '{"vehicle_id":"50000000-0000-4000-8000-000000000001"}') ->> 'status',
  'accepted', 'driver accepts the assigned vehicle and cargo');
select is(public.driver_update_trip_cargo_v1('20000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003',
  'confirm_cargo', pg_temp.release_cargo_payload('80000000-0000-4000-8000-000000000003')) ->> 'status',
  'ready_to_depart', 'driver confirms documents, quantities and loading evidence');
select lives_ok(
  $$select public.driver_save_checklist('80000000-0000-4000-8000-000000000003',
    'pre', '{"checked_items":[0,1,2,3,4,5,6,7],"total_items":8}')$$,
  'driver saves the complete pre-trip checklist');
select is(public.driver_update_trip_cargo_v1('20000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000004',
  'mark_departed') ->> 'status', 'departed', 'cargo departure requires the completed checklist');

select lives_ok(
  $$select public.driver_start_trip('80000000-0000-4000-8000-000000000003')$$,
  'assigned driver starts the canonical trip through an RPC'
);

select is(
  (select status from public.dispatch_trips where id = '80000000-0000-4000-8000-000000000003'),
  'in_transit',
  'trip start updates canonical trip status'
);

select is(
  (select status from public.loads where id = '70000000-0000-4000-8000-000000000003'),
  'in_transit',
  'trip start synchronizes assigned load status'
);

select ok(
  exists (
    select 1 from public.dispatch_events
    where dispatch_trip_id = '80000000-0000-4000-8000-000000000003'
      and event_type = 'trip_started'
  ),
  'trip start creates an audit event'
);

select is(
  (
    select count(*)::integer
    from public.loads load
    where load.status = 'in_transit'
      and exists (
        select 1
        from public.dispatch_trip_loads trip_load
        join public.dispatch_trips trip on trip.id = trip_load.dispatch_trip_id
        where trip_load.load_id = load.id
          and trip_load.tenant_id = load.tenant_id
          and (
            trip.status not in ('in_transit', 'in_progress')
            or trip.actual_start_at is null
          )
      )
  ),
  0,
  'no canonical load remains in transit with a non-started trip'
);

select throws_ok(
  $$select public.driver_start_trip('80000000-0000-4000-8000-000000000002')$$,
  '42501',
  'Viagem não atribuída ao motorista autenticado',
  'driver cannot start a known tenant B trip'
);

select throws_ok(
  $$select public.driver_create_event(
    '80000000-0000-4000-8000-000000000003',
    'lunch'
  )$$,
  '23514',
  null,
  'driver cannot pause a journey before starting it'
);


select lives_ok(
  $$select public.driver_create_event(
    '80000000-0000-4000-8000-000000000003',
    'start_shift'
  )$$,
  'driver starts the journey after the pre-trip checklist'
);

select throws_ok(
  $$select public.driver_create_event(
    '80000000-0000-4000-8000-000000000003',
    'start_shift'
  )$$,
  '23514',
  null,
  'driver cannot duplicate the journey start'
);

select lives_ok(
  $$select public.driver_create_event(
    '80000000-0000-4000-8000-000000000003',
    'lunch'
  )$$,
  'working driver starts a lunch pause'
);

select throws_ok(
  $$select public.driver_create_event(
    '80000000-0000-4000-8000-000000000003',
    'rest'
  )$$,
  '23514',
  null,
  'paused driver cannot start a second pause'
);

select lives_ok(
  $$select public.driver_create_event(
    '80000000-0000-4000-8000-000000000003',
    'resume'
  )$$,
  'paused driver resumes the journey'
);

select throws_ok(
  $$select public.driver_create_event(
    '80000000-0000-4000-8000-000000000003',
    'resume'
  )$$,
  '23514',
  null,
  'working driver cannot duplicate resume'
);

select throws_ok(
  $$select public.driver_create_event(
    '80000000-0000-4000-8000-000000000003',
    'end_shift'
  )$$,
  '23514',
  null,
  'driver cannot end the journey before the post-trip checklist'
);

select lives_ok(
  $$select public.driver_save_checklist(
    '80000000-0000-4000-8000-000000000003',
    'post',
    '{"checked_items":[0,1,2,3,4],"total_items":5}'::jsonb
  )$$,
  'driver saves the complete post-trip checklist'
);

select lives_ok(
  $$select public.driver_create_event(
    '80000000-0000-4000-8000-000000000003',
    'end_shift'
  )$$,
  'working driver ends the journey after the post-trip checklist'
);

select throws_ok(
  $$select public.driver_create_event(
    '80000000-0000-4000-8000-000000000003',
    'resume'
  )$$,
  '23514',
  null,
  'ended journey rejects resume until a new shift starts'
);

select lives_ok(
  $$select public.driver_create_operational_occurrence(
    '80000000-0000-4000-8000-000000000003',
    'other',
    'pgTAP trip-level occurrence',
    'medium',
    null,
    null
  )$$,
  'driver creates a trip-level occurrence without selecting a stop'
);

select results_eq(
  $$select
      dispatch_stop_id::text,
      client_id::text,
      load_id::text,
      fiscal_document_id::text,
      visible_to_client
    from public.operational_events
    where description = 'pgTAP trip-level occurrence'$$,
  $$values (null::text, null::text, null::text, null::text, false)$$,
  'trip-level occurrence does not infer stop, client, load, fiscal document, or portal visibility'
);

select lives_ok(
  $$select public.driver_create_operational_occurrence(
    '80000000-0000-4000-8000-000000000003',
    'damaged',
    'pgTAP stop occurrence',
    'high',
    '82000000-0000-4000-8000-000000000003',
    '40000000-0000-4000-8000-000000000001'
  )$$,
  'driver creates an occurrence for an explicit stop'
);

select results_eq(
  $$select
      dispatch_stop_id::text,
      client_id::text,
      load_id::text,
      fiscal_document_id::text,
      visible_to_client
    from public.operational_events
    where description = 'pgTAP stop occurrence'$$,
  $$values (
    '82000000-0000-4000-8000-000000000003'::text,
    '40000000-0000-4000-8000-000000000001'::text,
    '70000000-0000-4000-8000-000000000003'::text,
    '90000000-0000-4000-8000-000000000003'::text,
    false
  )$$,
  'explicit stop occurrence derives its tenant graph but remains internal'
);

select throws_ok(
  $$select public.driver_create_operational_occurrence(
    '80000000-0000-4000-8000-000000000003',
    'other',
    'cross-tenant stop attempt',
    'medium',
    '82000000-0000-4000-8000-000000000002',
    null
  )$$,
  '42501',
  'Parada não pertence à viagem do motorista',
  'driver cannot associate an occurrence with a stop from another tenant'
);

select throws_ok(
  $$select public.driver_mark_arrival(
    '82000000-0000-4000-8000-000000000003',
    -19.932,
    -44.053,
    10
  )$$,
  '23514',
  null,
  'driver cannot record arrival remotely outside the stop radius'
);

select lives_ok(
  $$select public.driver_mark_arrival(
    '82000000-0000-4000-8000-000000000003',
    -15.802,
    -43.313,
    10
  )$$,
  'assigned driver records arrival through the canonical RPC'
);

select is(
  (select status from public.dispatch_stops where id = '82000000-0000-4000-8000-000000000003'),
  'arrived',
  'arrival persists on the stop'
);

select is(
  (select payload ->> 'geofence_verified'
   from public.dispatch_events
   where dispatch_stop_id = '82000000-0000-4000-8000-000000000003'
     and event_type = 'arrival'
   order by event_at desc
   limit 1),
  'true',
  'arrival persists verified GPS evidence'
);

select throws_ok(
  $$select public.driver_finalize_delivery(
    '82000000-0000-4000-8000-000000000003',
    'Recebedor pgTAP',
    null,
    array['20000000-0000-4000-8000-000000000001/deliveries/pgtap.jpg']
  )$$,
  '42501', 'permission denied for function driver_finalize_delivery',
  'authenticated driver cannot execute the retired delivery RPC'
);
reset role;
set local role service_role;
select throws_ok(
  $$select public.driver_finalize_delivery(
    '82000000-0000-4000-8000-000000000003', 'Recebedor pgTAP', null,
    array['20000000-0000-4000-8000-000000000001/deliveries/pgtap.jpg'])$$,
  '55000', 'driver_legacy_delivery_contract_retired',
  'service caller also receives the explicit retired delivery contract error'
);
reset role;
set local role authenticated;

insert into release_delivery_request (details)
select jsonb_build_object(
  'receiver_name', 'Recebedor pgTAP', 'notes', 'Entrega de teste com evidências sintéticas',
  'latitude', -15.802, 'longitude', -43.313, 'accuracy_m', 10,
  'signature_path', prefix || 'signatures/signature.png',
  'photo_paths', jsonb_build_array(prefix || 'receipt/processed/scan.jpg'),
  'receipt_original_path', prefix || 'receipt/original/photo.jpg',
  'receipt_processed_path', prefix || 'receipt/processed/scan.jpg',
  'receipt_original_hash', repeat('a', 64), 'receipt_processed_hash', repeat('b', 64),
  'receipt_scan_mode', 'document_scan',
  'receipt_scan_quality', jsonb_build_object('accepted', true, 'sharpness', 10),
  'receipt_crop', jsonb_build_object('left', 0.02, 'top', 0.02, 'right', 0.98, 'bottom', 0.98),
  'receipt_rotation', 0, 'receipt_quality_confirmed', true, 'captured_at', clock_timestamp(),
  'fiscal_snapshot', public.get_driver_delivery_fiscal_snapshot_v1(
    '20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000003',
    '82000000-0000-4000-8000-000000000003'))
from (values ('20000000-0000-4000-8000-000000000001/deliveries/80000000-0000-4000-8000-000000000003/82000000-0000-4000-8000-000000000003/')) fixture(prefix);

select is(public.driver_record_delivery_outcome('82000000-0000-4000-8000-000000000003',
  'delivered', (select jsonb_set(details, '{fiscal_snapshot,revision}', to_jsonb(repeat('0', 32)))
    from release_delivery_request), 'a0000000-0000-4000-8000-000000000010', 'arrived') ->> 'error_code',
  'delivery_fiscal_snapshot_changed', 'stale fiscal snapshot rejects delivery confirmation');
select is((select status from public.dispatch_stops where id = '82000000-0000-4000-8000-000000000003'),
  'arrived', 'fiscal snapshot conflict leaves the stop open');
select is(public.driver_record_delivery_outcome('82000000-0000-4000-8000-000000000003',
  'delivered', (select details from release_delivery_request),
  'a0000000-0000-4000-8000-000000000011', 'arrived') ->> 'stop_outcome',
  'delivered', 'assigned driver confirms delivery with fiscal snapshot, GPS and scan evidence');
select is(public.driver_record_delivery_outcome('82000000-0000-4000-8000-000000000003',
  'delivered', (select details from release_delivery_request),
  'a0000000-0000-4000-8000-000000000011', 'arrived') ->> 'replayed',
  'true', 'identical delivery request replays after the stop is closed');
select is((select count(*)::integer from public.dispatch_events
  where dispatch_stop_id = '82000000-0000-4000-8000-000000000003' and event_type = 'delivery_delivered'),
  1, 'delivery replay does not duplicate its dispatch event');

select is(
  (select status from public.dispatch_stops where id = '82000000-0000-4000-8000-000000000003'),
  'delivered',
  'delivery finalization closes the stop'
);

select is(
  (select status from public.dispatch_trips where id = '80000000-0000-4000-8000-000000000003'),
  'completed',
  'last terminal stop completes the trip'
);

select is(
  (select receiver_name from public.proof_of_delivery
   where fiscal_document_id = '90000000-0000-4000-8000-000000000003'),
  'Recebedor pgTAP',
  'delivery finalization persists POD receiver evidence'
);

-- Complete custody of the first trip before starting the second route. The
-- driver's one-active-trip invariant remains enabled throughout the test.
select is(public.driver_update_trip_cargo_v1('20000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000012',
  'mark_returned') ->> 'status', 'returned', 'driver returns cargo after terminal stops and post-checklist');
select is(public.driver_update_trip_cargo_v1('20000000-0000-4000-8000-000000000001',
  (select id from release_test_trips where name = 'planned'), 'a0000000-0000-4000-8000-000000000013',
  'accept', '{"vehicle_id":"50000000-0000-4000-8000-000000000001"}') ->> 'status',
  'accepted', 'driver accepts cargo for the second planned route');
select is(public.driver_update_trip_cargo_v1('20000000-0000-4000-8000-000000000001',
  (select id from release_test_trips where name = 'planned'), 'a0000000-0000-4000-8000-000000000014',
  'confirm_cargo', pg_temp.release_cargo_payload((select id from release_test_trips where name = 'planned'))) ->> 'status',
  'ready_to_depart', 'second route confirms its own cargo graph and evidence');
select lives_ok(
  $$select public.driver_save_checklist((select id from release_test_trips where name = 'planned'),
    'pre', '{"checked_items":[0,1,2,3,4,5,6,7],"total_items":8}')$$,
  'second route requires a new pre-trip checklist after the previous shift');
select is(public.driver_update_trip_cargo_v1('20000000-0000-4000-8000-000000000001',
  (select id from release_test_trips where name = 'planned'), 'a0000000-0000-4000-8000-000000000015',
  'mark_departed') ->> 'status', 'departed', 'second route independently satisfies the departure gate');

select lives_ok(
  $$select public.driver_start_trip((
    select id from release_test_trips where name = 'planned'
  ))$$,
  'assigned driver starts the newly planned route'
);

select is(
  (select status from public.dispatch_trips where id = (
    select id from release_test_trips where name = 'planned'
  )),
  'in_transit',
  'starting the newly planned route persists its trip status'
);

select ok(
  (select actual_start_at is not null from public.dispatch_trips where id = (
    select id from release_test_trips where name = 'planned'
  )),
  'starting a route persists its actual start timestamp atomically'
);

select is(
  (select trip_id from public.loads where id = md5('agvlog-e2e-load-a-2')::uuid),
  (select id from release_test_trips where name = 'planned'),
  'starting a route synchronizes the load trip mirror'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","active_tenant_id":"20000000-0000-4000-8000-000000000001"}',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.get_user_tenant_ids()),
  1,
  'owner tenant access remains available at AAL1'
);

select is(
  public.is_tenant_admin('20000000-0000-4000-8000-000000000001'),
  true,
  'owner is authorized as admin at AAL1'
);

select is(
  public.is_tenant_admin('20000000-0000-4000-8000-000000000002'),
  false,
  'owner cannot administer another tenant at AAL1'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","active_tenant_id":"20000000-0000-4000-8000-000000000001"}',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.get_user_tenant_ids()),
  1,
  'owner tenant access remains available at AAL2'
);

select is(
  public.is_tenant_admin('20000000-0000-4000-8000-000000000001'),
  true,
  'owner remains authorized as admin at AAL2'
);

select is(
  public.is_tenant_admin('20000000-0000-4000-8000-000000000002'),
  false,
  'owner cannot administer another tenant at AAL2'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_tenant_with_owner(text)',
    'EXECUTE'
  ),
  'anonymous users cannot provision tenants'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_tenant_with_owner(text)',
    'EXECUTE'
  ),
  'authenticated users cannot provision tenants'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.create_tenant_with_owner(text)',
    'EXECUTE'
  ),
  'legacy tenant provisioning is not a service-role API'
);

select is(
  (
    select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prosecdef
      and has_function_privilege('authenticated', procedure.oid, 'execute')
      and procedure.proname in (
        'assign_fiscal_documents_to_load',
        'audit_data_consistency_v4',
        'audit_operational_congruence_v1',
        'create_load_v1',
        'delete_load_item_v1',
        'driver_report_event_v1',
        'execute_data_repair_v1',
        'handle_new_user',
        'remove_fiscal_documents_from_load',
        'update_load_v1'
      )
  ),
  0,
  'classified legacy and internal SECURITY DEFINER routines are not executable by authenticated users'
);

-- ROLLBACK does not run deferred constraint triggers. Exercise the same graph
-- constraints a COMMIT would check before discarding this test's mutations.
set constraints all immediate;
select * from finish();
rollback;
