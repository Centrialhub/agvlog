-- Read-only catalog verification; safe for the release target.
do $$
declare role_name text;
begin
 if not exists(select 1 from pg_attribute where attrelid='public.loads'::regclass
  and attname='operational_archived_at' and atttypid='timestamptz'::regtype and not attisdropped) then
  raise exception 'archive column missing';end if;
 if not exists(select 1 from pg_policy where polrelid='public.loads'::regclass
  and polname='operational_load_active_listing' and not polpermissive and polcmd='r') then
  raise exception 'archive listing restriction missing';end if;
 if not exists(select 1 from pg_class where oid='private.operational_load_archives'::regclass and relrowsecurity) then
  raise exception 'archive RLS missing';end if;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if has_function_privilege(role_name,'private.archive_non_jmacedo_load_for_cleanup(uuid,uuid,integer,text)','execute')
   or has_table_privilege(role_name,'private.operational_load_archives','select,insert,update,delete') then
   raise exception 'archive maintenance exposed to %',role_name;end if;
 end loop;
 if (select prosecdef from pg_proc where oid='private.archive_non_jmacedo_load_for_cleanup(uuid,uuid,integer,text)'::regprocedure) then
  raise exception 'archive maintenance must be invoker';end if;
end $$;
