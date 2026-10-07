-- Prepared supplemental migration. Apply only to the coordinated isolated
-- candidate after current reader catalog/ACL capture and reviewed preflight.
-- Restore row DTO fields without changing either reader's authorization/filter,
-- paging/snapshot behavior, signature, ownership or privileges. The reply flag
-- also honors the visibility check already enforced by reply_client_occurrence_v2.
do $portal_row_actions$
declare
  target record;
  function_oid regprocedure;
  original_metadata jsonb;
  original_acl jsonb;
  current_body text;
  definition text;
  original_hash text;
  patched_hash text;
  needle text;
  replacement text;
  expected_acl constant jsonb := '[
    ["authenticated","postgres","EXECUTE",false],
    ["postgres","postgres","EXECUTE",false],
    ["service_role","postgres","EXECUTE",false]
  ]'::jsonb;
begin
  if to_regprocedure('public._portal_assert_client_access(uuid,uuid)') is null
    or to_regprocedure('public._portal_user_has_perm(uuid,uuid,text)') is null
    or to_regprocedure('public._portal_user_client_ids(uuid)') is null
    or to_regprocedure('public.portal_user_can_access_pickup_order(uuid,uuid)') is null then
    raise exception 'portal_row_actions_dependency_missing';
  end if;
  -- These two helper bodies are pinned by the original/frozen native captures.
  if (select md5(prosrc) from pg_proc where oid =
      'public._portal_assert_client_access(uuid,uuid)'::regprocedure)
      is distinct from '0f783dc95231ebc836ba0182e1d75d91'
    or (select md5(prosrc) from pg_proc where oid =
      'public._portal_user_has_perm(uuid,uuid,text)'::regprocedure)
      is distinct from 'e37f12dde2b26c096d4bb4a6b1a58af4' then
    raise exception 'portal_row_actions_authorization_helper_changed';
  end if;

  for target in select * from (values
    ('public.list_client_pickups_page_v1(uuid,uuid,text,timestamptz,timestamptz,integer,timestamptz,jsonb,text)',
      'b6189d64b30fe17ddc5333e35b5604f0', 'f0b9ad1bbfde7c885a41077685054de5',
      'select p.id, p.pickup_number, p.remitter_name, p.remitter_cnpj, p.recipient_name,',
      E'select p.id, p.remitter_client_id as client_id,\n      public._portal_user_has_perm(_tenant_id, p.remitter_client_id, ''can_request_pickup'') as can_cancel,\n      p.pickup_number, p.remitter_name, p.remitter_cnpj, p.recipient_name,'),
    ('public.list_client_occurrences_page_v1(uuid,uuid,text,boolean,integer,timestamptz,jsonb,text)',
      'd6e1af4fee570817c7a31ccb5555ccf0', 'd425604618db614ba9beb2f7791f8aad',
      'select oe.id, oe.load_id, oe.order_id, oe.event_type, oe.severity, oe.description,',
      E'select oe.id, oe.client_id,\n      (public._portal_user_has_perm(_tenant_id, oe.client_id, ''can_open_occurrences'') and oe.visible_to_client = true) as can_reply,\n      oe.load_id, oe.order_id, oe.event_type, oe.severity, oe.description,')
  ) as inputs(signature, original_hash, patched_hash, needle, replacement) loop
    function_oid := to_regprocedure(target.signature);
    if function_oid is null then
      raise exception 'portal_row_actions_reader_missing: %', target.signature;
    end if;
    select to_jsonb(p) - 'prosrc', p.prosrc
      into original_metadata, current_body from pg_proc p where p.oid = function_oid;
    if not exists (select 1 from pg_proc p join pg_roles r on r.oid = p.proowner
        join pg_language l on l.oid = p.prolang
        where p.oid = function_oid and r.rolname = 'postgres'
          and l.lanname = 'plpgsql' and p.prokind = 'f'
          and p.prosecdef and p.provolatile = 's' and not p.proleakproof
          and not p.proretset and p.prorettype = 'jsonb'::regtype
          and p.proconfig = array['search_path=""']) then
      raise exception 'portal_row_actions_reader_metadata_changed: %', target.signature;
    end if;
    select jsonb_agg(jsonb_build_array(
        case when a.grantee = 0 then 'PUBLIC' else grantee.rolname end,
        grantor.rolname, a.privilege_type, a.is_grantable)
        order by case when a.grantee = 0 then 'PUBLIC' else grantee.rolname end,
          grantor.rolname, a.privilege_type, a.is_grantable)
      into original_acl
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
      left join pg_roles grantee on grantee.oid = a.grantee
      left join pg_roles grantor on grantor.oid = a.grantor
      where p.oid = function_oid;
    if original_acl is distinct from expected_acl then
      raise exception 'portal_row_actions_reader_acl_changed: %', target.signature;
    end if;
    original_hash := target.original_hash;
    patched_hash := target.patched_hash;
    if md5(current_body) not in (original_hash, patched_hash) then
      raise exception 'portal_row_actions_reader_body_changed: %', target.signature;
    end if;
    if md5(current_body) = original_hash then
      needle := target.needle;
      replacement := target.replacement;
      if (length(current_body) - length(replace(current_body,needle,'')))
          / length(needle) <> 1 then
        raise exception 'portal_row_actions_projection_anchor_changed: %', target.signature;
      end if;
      if md5(replace(current_body,needle,replacement)) is distinct from patched_hash then
        raise exception 'portal_row_actions_patched_body_hash_mismatch: %', target.signature;
      end if;
      definition := pg_get_functiondef(function_oid);
      execute replace(definition,needle,replacement);
    end if;
    if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = function_oid)
        is distinct from original_metadata
      or (select md5(prosrc) from pg_proc where oid = function_oid)
        is distinct from patched_hash then
      raise exception 'portal_row_actions_postcondition_failed: %', target.signature;
    end if;
  end loop;
end;
$portal_row_actions$;
