begin;

select plan(90);

select has_table('public', 'tenant_feature_policy', 'tenant capability policy exists');

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
  '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',
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
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',
  true
);
set local role authenticated;

select lives_ok(
  $$select public.driver_start_trip((
    select result_id from public.idempotency_keys
    where tenant_id = '20000000-0000-4000-8000-000000000001'
      and operation = 'plan_dispatch_trip'
      and idempotency_key = 'pgtap-route-plan-contract-001'
  ))$$,
  'assigned driver starts the newly planned route'
);

select is(
  (select status from public.dispatch_trips where id = (
    select result_id from public.idempotency_keys
    where tenant_id = '20000000-0000-4000-8000-000000000001'
      and operation = 'plan_dispatch_trip'
      and idempotency_key = 'pgtap-route-plan-contract-001'
  )),
  'in_transit',
  'starting the newly planned route persists its trip status'
);

select ok(
  (select actual_start_at is not null from public.dispatch_trips where id = (
    select result_id from public.idempotency_keys
    where tenant_id = '20000000-0000-4000-8000-000000000001'
      and operation = 'plan_dispatch_trip'
      and idempotency_key = 'pgtap-route-plan-contract-001'
  )),
  'starting a route persists its actual start timestamp atomically'
);

select is(
  (select trip_id from public.loads where id = md5('agvlog-e2e-load-a-2')::uuid),
  (select result_id from public.idempotency_keys
   where tenant_id = '20000000-0000-4000-8000-000000000001'
     and operation = 'plan_dispatch_trip'
     and idempotency_key = 'pgtap-route-plan-contract-001'),
  'starting a route synchronizes the load trip mirror'
);

select lives_ok(
  $$select public.driver_start_trip('80000000-0000-4000-8000-000000000001')$$,
  'assigned driver starts the canonical trip through an RPC'
);

select is(
  (select status from public.dispatch_trips where id = '80000000-0000-4000-8000-000000000001'),
  'in_transit',
  'trip start updates canonical trip status'
);

select is(
  (select status from public.loads where id = '70000000-0000-4000-8000-000000000001'),
  'in_transit',
  'trip start synchronizes assigned load status'
);

select ok(
  exists (
    select 1 from public.dispatch_events
    where dispatch_trip_id = '80000000-0000-4000-8000-000000000001'
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
    '80000000-0000-4000-8000-000000000001',
    'lunch'
  )$$,
  '23514',
  null,
  'driver cannot pause a journey before starting it'
);

select lives_ok(
  $$select public.driver_save_checklist(
    '80000000-0000-4000-8000-000000000001',
    'pre',
    '{"checked_items":[0,1,2,3,4,5,6,7],"total_items":8}'::jsonb
  )$$,
  'driver saves the complete pre-trip checklist'
);

select lives_ok(
  $$select public.driver_create_event(
    '80000000-0000-4000-8000-000000000001',
    'start_shift'
  )$$,
  'driver starts the journey after the pre-trip checklist'
);

select throws_ok(
  $$select public.driver_create_event(
    '80000000-0000-4000-8000-000000000001',
    'start_shift'
  )$$,
  '23514',
  null,
  'driver cannot duplicate the journey start'
);

select lives_ok(
  $$select public.driver_create_event(
    '80000000-0000-4000-8000-000000000001',
    'lunch'
  )$$,
  'working driver starts a lunch pause'
);

select throws_ok(
  $$select public.driver_create_event(
    '80000000-0000-4000-8000-000000000001',
    'rest'
  )$$,
  '23514',
  null,
  'paused driver cannot start a second pause'
);

select lives_ok(
  $$select public.driver_create_event(
    '80000000-0000-4000-8000-000000000001',
    'resume'
  )$$,
  'paused driver resumes the journey'
);

select throws_ok(
  $$select public.driver_create_event(
    '80000000-0000-4000-8000-000000000001',
    'resume'
  )$$,
  '23514',
  null,
  'working driver cannot duplicate resume'
);

select throws_ok(
  $$select public.driver_create_event(
    '80000000-0000-4000-8000-000000000001',
    'end_shift'
  )$$,
  '23514',
  null,
  'driver cannot end the journey before the post-trip checklist'
);

select lives_ok(
  $$select public.driver_save_checklist(
    '80000000-0000-4000-8000-000000000001',
    'post',
    '{"checked_items":[0,1,2,3,4],"total_items":5}'::jsonb
  )$$,
  'driver saves the complete post-trip checklist'
);

select lives_ok(
  $$select public.driver_create_event(
    '80000000-0000-4000-8000-000000000001',
    'end_shift'
  )$$,
  'working driver ends the journey after the post-trip checklist'
);

select throws_ok(
  $$select public.driver_create_event(
    '80000000-0000-4000-8000-000000000001',
    'resume'
  )$$,
  '23514',
  null,
  'ended journey rejects resume until a new shift starts'
);

select lives_ok(
  $$select public.driver_create_operational_occurrence(
    '80000000-0000-4000-8000-000000000001',
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
    '80000000-0000-4000-8000-000000000001',
    'damaged',
    'pgTAP stop occurrence',
    'high',
    '82000000-0000-4000-8000-000000000001',
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
    '82000000-0000-4000-8000-000000000001'::text,
    '40000000-0000-4000-8000-000000000001'::text,
    '70000000-0000-4000-8000-000000000001'::text,
    '90000000-0000-4000-8000-000000000001'::text,
    false
  )$$,
  'explicit stop occurrence derives its tenant graph but remains internal'
);

select throws_ok(
  $$select public.driver_create_operational_occurrence(
    '80000000-0000-4000-8000-000000000001',
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
    '82000000-0000-4000-8000-000000000001',
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
    '82000000-0000-4000-8000-000000000001',
    -15.802,
    -43.313,
    10
  )$$,
  'assigned driver records arrival through the canonical RPC'
);

select is(
  (select status from public.dispatch_stops where id = '82000000-0000-4000-8000-000000000001'),
  'arrived',
  'arrival persists on the stop'
);

select is(
  (select payload ->> 'geofence_verified'
   from public.dispatch_events
   where dispatch_stop_id = '82000000-0000-4000-8000-000000000001'
     and event_type = 'arrival'
   order by event_at desc
   limit 1),
  'true',
  'arrival persists verified GPS evidence'
);

select lives_ok(
  $$select public.driver_finalize_delivery(
    '82000000-0000-4000-8000-000000000001',
    'Recebedor pgTAP',
    null,
    array['20000000-0000-4000-8000-000000000001/deliveries/pgtap.jpg']
  )$$,
  'assigned driver finalizes the delivery through the canonical RPC'
);

select is(
  (select status from public.dispatch_stops where id = '82000000-0000-4000-8000-000000000001'),
  'delivered',
  'delivery finalization closes the stop'
);

select is(
  (select status from public.dispatch_trips where id = '80000000-0000-4000-8000-000000000001'),
  'completed',
  'last terminal stop completes the trip'
);

select is(
  (select receiver_name from public.proof_of_delivery
   where fiscal_document_id = '90000000-0000-4000-8000-000000000001'),
  'Recebedor pgTAP',
  'delivery finalization persists POD receiver evidence'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.get_user_tenant_ids()),
  0,
  'owner tenant access is denied at AAL1'
);

select is(
  public.is_tenant_admin('20000000-0000-4000-8000-000000000001'),
  false,
  'owner is not authorized as admin at AAL1'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.get_user_tenant_ids()),
  1,
  'owner tenant access is restored at AAL2'
);

select is(
  public.is_tenant_admin('20000000-0000-4000-8000-000000000001'),
  true,
  'owner is authorized as admin at AAL2'
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

select * from finish();
rollback;
