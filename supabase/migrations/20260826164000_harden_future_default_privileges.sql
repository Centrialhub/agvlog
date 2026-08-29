-- Keep future public-schema objects private for every object owner the current
-- migration session is allowed to manage. Hosted Supabase intentionally keeps
-- postgres out of the supabase_admin role, so attempting ALTER DEFAULT
-- PRIVILEGES for that platform-owned role would abort the whole cutover.

DO $block$
DECLARE
  object_owner name;
BEGIN
  FOREACH object_owner IN ARRAY ARRAY['postgres'::name, 'supabase_admin'::name]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = object_owner)
       AND pg_catalog.pg_has_role(current_user, object_owner, 'MEMBER') THEN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated, service_role',
        object_owner
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role',
        object_owner
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role',
        object_owner
      );
    ELSE
      RAISE NOTICE 'Skipping default privileges for unmanaged role %', object_owner;
    END IF;
  END LOOP;
END;
$block$;
