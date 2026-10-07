-- Narrow A5 correction; never replay the material-audit historical migration.
-- Review native fingerprints before applying to an isolated target. No new grants or RLS changes.
DO $restore_operational_route_name_audit$
DECLARE
  public_oid oid; private_oid oid; function_oid oid; helper_oid oid;
  predecessor pg_catalog.pg_proc%ROWTYPE;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '3s', true);

  public_oid := pg_catalog.to_regprocedure('public.operational_routes_audit_name()');
  private_oid := pg_catalog.to_regprocedure('private.operational_routes_audit_name()');
  IF (public_oid IS NULL) = (private_oid IS NULL) THEN
    RAISE EXCEPTION 'operational_route_audit_namespace_changed' USING ERRCODE = '55000';
  END IF;
  function_oid := coalesce(public_oid, private_oid);
  SELECT * INTO predecessor FROM pg_catalog.pg_proc WHERE oid = function_oid;
  IF predecessor.prokind <> 'f' OR predecessor.pronargs <> 0
    OR predecessor.prorettype <> 'pg_catalog.trigger'::pg_catalog.regtype
    OR pg_catalog.pg_get_userbyid(predecessor.proowner) <> 'postgres'
    OR predecessor.prolang <> (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
    OR predecessor.provolatile <> 'v' OR predecessor.proisstrict OR predecessor.proleakproof
    OR predecessor.proparallel <> 'u' OR predecessor.procost <> 100
    OR (public_oid IS NOT NULL AND (predecessor.prosecdef
      OR predecessor.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
      OR pg_catalog.md5(pg_catalog.regexp_replace(predecessor.prosrc, '[[:space:]]', '', 'g')) <> '4cfc805c86f0eea3960b7d5f4ddc31b5'))
    OR (private_oid IS NOT NULL AND (NOT predecessor.prosecdef
      OR predecessor.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
      OR pg_catalog.md5(pg_catalog.regexp_replace(predecessor.prosrc, '[[:space:]]', '', 'g')) <> 'f6ca5ae3ea7607acbb5f11beb2d946b6')) THEN
    RAISE EXCEPTION 'operational_route_audit_predecessor_changed' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname = 'private'
      AND pg_catalog.pg_get_userbyid(n.nspowner) = 'postgres')
    OR pg_catalog.has_schema_privilege('authenticated', 'private', 'CREATE')
    OR pg_catalog.has_schema_privilege('anon', 'private', 'CREATE')
    OR pg_catalog.has_function_privilege('authenticated', function_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'operational_route_audit_privilege_changed' USING ERRCODE = '55000';
  END IF;
  helper_oid := pg_catalog.to_regprocedure('public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text)');
  IF helper_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = helper_oid
      AND p.prosecdef AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      AND pg_catalog.md5(pg_catalog.regexp_replace(p.prosrc, '[[:space:]]', '', 'g')) = '5cf6b4d6eb565dad13fac6a391137e21')
    OR pg_catalog.has_function_privilege('authenticated', helper_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon', helper_oid, 'EXECUTE')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid = pg_catalog.to_regprocedure('private.is_request_tenant_member(uuid)')
        AND p.prosecdef AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
        AND pg_catalog.md5(p.prosrc) = '27bf2e71e1cf52212ac213a23de03dd7') THEN
    RAISE EXCEPTION 'operational_route_audit_writer_or_context_changed' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgfoid = function_oid AND NOT t.tgisinternal) <> 1
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgfoid = function_oid
      AND t.tgrelid = 'public.operational_routes'::pg_catalog.regclass
      AND t.tgname = 'trg_operational_routes_audit_name' AND t.tgtype = 17
      AND t.tgenabled = 'O' AND NOT t.tgisinternal AND t.tgnargs = 0
      AND t.tgattr::text = (SELECT a.attnum::text FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = t.tgrelid AND a.attname = 'name' AND NOT a.attisdropped))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid = 'public.operational_routes'::pg_catalog.regclass AND NOT t.tgisinternal
        AND t.tgname IN ('trg_audit_operational_route_material_edit', 'trg_stamp_operational_route_material_editor')) THEN
    RAISE EXCEPTION 'operational_route_audit_binding_changed' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
      WHERE c.oid = 'public.entity_audit_log'::pg_catalog.regclass AND c.relrowsecurity)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
      WHERE p.polrelid = 'public.entity_audit_log'::pg_catalog.regclass
        AND p.polpermissive AND p.polcmd IN ('a', '*')
        AND (0 = ANY(p.polroles) OR (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') = ANY(p.polroles)))
    OR (SELECT count(*) FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = 'public.entity_audit_log'::pg_catalog.regclass AND a.attnum > 0 AND NOT a.attisdropped) <> 12
    OR EXISTS (SELECT 1 FROM (VALUES
      ('id','uuid',true),('tenant_id','uuid',true),('entity_type','text',true),('entity_id','uuid',true),
      ('action','text',true),('old_data','jsonb',false),('new_data','jsonb',false),('actor_user_id','uuid',false),
      ('actor_role','text',false),('source','text',false),('request_id','text',false),('created_at','timestamptz',true)
    ) expected(name,type_name,required) WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_type typ ON typ.oid = a.atttypid
      WHERE a.attrelid = 'public.entity_audit_log'::pg_catalog.regclass AND a.attname = expected.name
        AND NOT a.attisdropped AND typ.typname = expected.type_name AND a.attnotnull = expected.required))
    OR (SELECT count(*) FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a
      ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      WHERE d.adrelid = 'public.entity_audit_log'::pg_catalog.regclass
        AND ((a.attname = 'id' AND pg_catalog.pg_get_expr(d.adbin,d.adrelid) IN ('gen_random_uuid()', 'extensions.gen_random_uuid()'))
          OR (a.attname = 'created_at' AND pg_catalog.pg_get_expr(d.adbin,d.adrelid) = 'now()'))) <> 2 THEN
    RAISE EXCEPTION 'operational_route_audit_log_contract_changed' USING ERRCODE = '55000';
  END IF;

  IF private_oid IS NOT NULL THEN RETURN; END IF;
  ALTER FUNCTION public.operational_routes_audit_name() SET SCHEMA private;
  EXECUTE $definition$CREATE OR REPLACE FUNCTION private.operational_routes_audit_name()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF TG_RELID <> pg_catalog.to_regclass('public.operational_routes')
    OR TG_NAME <> 'trg_operational_routes_audit_name' OR TG_OP <> 'UPDATE'
    OR TG_WHEN <> 'AFTER' OR TG_LEVEL <> 'ROW' OR TG_NARGS <> 0 THEN
    RAISE EXCEPTION 'operational_route_audit_context_invalid' USING ERRCODE = '42501';
  END IF;
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    IF NEW.id IS NULL OR NEW.tenant_id IS NULL
      OR NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
      OR auth.uid() IS NULL OR NOT coalesce(private.is_request_tenant_member(NEW.tenant_id), false)
      OR NOT EXISTS (
        SELECT 1 FROM public.tenant_memberships membership
        WHERE membership.tenant_id = NEW.tenant_id AND membership.user_id = auth.uid()
          AND membership.active AND membership.role::text IN ('owner', 'admin', 'operator')
      ) THEN
      RAISE EXCEPTION 'operational_route_audit_actor_invalid' USING ERRCODE = '42501';
    END IF;
    PERFORM public._log_entity_audit(
      NEW.tenant_id, 'operational_route', NEW.id, 'rename',
      pg_catalog.jsonb_build_object('name', OLD.name),
      pg_catalog.jsonb_build_object('name', NEW.name), 'operational_routes_audit_name'
    );
  END IF;
  RETURN NEW;
END;
$function$;$definition$;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = function_oid
      AND p.proowner = predecessor.proowner AND p.proacl IS NOT DISTINCT FROM predecessor.proacl)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgfoid = function_oid
      AND t.tgname = 'trg_operational_routes_audit_name' AND t.tgrelid = 'public.operational_routes'::pg_catalog.regclass) THEN
    RAISE EXCEPTION 'operational_route_audit_identity_changed' USING ERRCODE = '55000';
  END IF;
END;
$restore_operational_route_name_audit$;
