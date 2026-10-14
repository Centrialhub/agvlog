-- REVIEW PROPOSAL ONLY: not a migration, not automatically applied by release tooling.
-- Requires exact 65f4e9bd / 20261012224659 predecessor. No DML, Auth writes or grants.
-- Extends existing OLD-identity unlink/replacement and registry-delete protection to
-- accounts created directly by username, preserving converted-account protections.
do $patch$
declare p jsonb; target oid; original text; definition text; metadata jsonb; patched text;
begin
  for p in select value from jsonb_array_elements($manifest$[{"signature":"private.guard_driver_account_scope_v1()","before":"ca6e0ce58e27d1e68ba2b91865b4cc3f","after":"e613a1e24ffcf2a56dbb57f18ebfd9be","needle":"AND coalesce(u.raw_app_meta_data->>'driver_workspace_managed','false')='true' FOR SHARE NOWAIT;","replacement":"AND (coalesce(u.raw_app_meta_data->>'driver_workspace_managed','false')='true'\n        OR coalesce(u.raw_app_meta_data->>'driver_username_managed','false')='true') FOR SHARE NOWAIT;"},{"signature":"private.protect_converted_driver_registry_delete_v1()","before":"01666daa80094722b3da5d1509764219","after":"ad9e68d28632e8102aaafefa30200fcf","needle":"and coalesce(u.raw_app_meta_data->>'driver_workspace_managed','false')='true' for share nowait;","replacement":"and (coalesce(u.raw_app_meta_data->>'driver_workspace_managed','false')='true'\n        or coalesce(u.raw_app_meta_data->>'driver_username_managed','false')='true') for share nowait;"}]$manifest$::jsonb) loop
    target:=to_regprocedure(p->>'signature');
    if target is null then raise exception 'driver_link_protection_predecessor_missing';end if;
    select prosrc,pg_get_functiondef(oid),to_jsonb(f)-'prosrc' into original,definition,metadata
      from pg_proc f where oid=target;
    if md5(original)=p->>'after' then continue;end if;
    if md5(original)<>p->>'before' then raise exception 'driver_link_protection_predecessor_changed';end if;
    patched:=replace(original,p->>'needle',p->>'replacement');
    if md5(patched)<>p->>'after' then raise exception 'driver_link_protection_patch_mismatch';end if;
    execute replace(definition,original,patched);
    if (select to_jsonb(f)-'prosrc' from pg_proc f where oid=target) is distinct from metadata
      or (select md5(prosrc) from pg_proc where oid=target)<>p->>'after' then
      raise exception 'driver_link_protection_metadata_changed';end if;
  end loop;
end;$patch$;
