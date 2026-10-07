-- A5: the INSERT candidate of a negative delta violates CHECK before ON CONFLICT.
-- The captured native predecessor is 17/09, not the later repository normalization.
-- Change only its body: preserve OID, owner, ACL, signature, RLS, triggers and constraints.
-- This forward must run transactionally against the reviewed baseline, never via replay.
set local lock_timeout='3s';
set local statement_timeout='30s';
do $inventory_outbound$
declare p record;after_metadata jsonb;before_metadata jsonb;before_contract jsonb;after_contract jsonb;
 body text;needle text;patched text;
begin
 if not pg_try_advisory_xact_lock(hashtext('inventory-outbound-release'),1) then
  raise exception 'inventory_outbound_release_busy' using errcode='55000';end if;
 select f.*,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang
 where f.oid=to_regprocedure('public.update_inventory_balance()');
 if not found or md5(replace(p.prosrc,E'\r\n',E'\n'))<>'b0ff5c10a960fc655a62032273b645f0'
  or p.proconfig is distinct from array['search_path=""']::text[] or not p.prosecdef
  or p.provolatile<>'v' or p.prokind<>'f' or p.prorettype<>'trigger'::regtype or p.lanname<>'plpgsql'
  or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute')
  or not has_function_privilege('service_role',p.oid,'execute')
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where a.privilege_type='EXECUTE' and a.grantee not in(p.proowner,'service_role'::regrole::oid)) then
  raise exception 'inventory_outbound_predecessor_changed' using errcode='55000';end if;
 if not exists(select 1 from pg_constraint where conrelid='public.inventory_balances'::regclass
  and conname='inventory_balances_logical_key' and pg_get_constraintdef(oid)='UNIQUE NULLS NOT DISTINCT (tenant_id, location_id, client_id, item_description)')
  or not exists(select 1 from pg_constraint where conrelid='public.inventory_balances'::regclass
   and conname='inventory_balances_dimensions_nonnegative'
   and pg_get_constraintdef(oid)='CHECK (((quantity >= (0)::numeric) AND (pallet_count >= 0) AND (weight_kg >= (0)::numeric) AND (volume_m3 >= (0)::numeric))) NOT VALID')
  or not exists(select 1 from pg_trigger where tgrelid='public.inventory_movements'::regclass
   and tgname='trg_inventory_movement_balance' and tgfoid=p.oid and tgtype=5 and tgenabled='O' and not tgisinternal
   and tgqual is null and tgnargs=0 and tgargs=''::bytea)
  or not exists(select 1 from pg_trigger t join pg_proc f on f.oid=t.tgfoid
   where t.tgrelid='public.inventory_movements'::regclass and t.tgname='guard_inventory_movement_history'
    and t.tgtype=27 and t.tgenabled='O' and not t.tgisinternal
    and t.tgqual is null and t.tgnargs=0 and t.tgargs=''::bytea
    and f.oid=to_regprocedure('public.guard_inventory_movement_history()')
    and md5(replace(f.prosrc,E'\r\n',E'\n'))='9f9ba6e120aade84acf390f0416ecfef') then
  raise exception 'inventory_outbound_balance_contract_changed' using errcode='55000';end if;
 select to_jsonb(f)-'prosrc' into before_metadata from pg_proc f where f.oid=p.oid;
 select jsonb_build_object(
  'constraints',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_constraint c where c.conrelid in('public.inventory_balances'::regclass,'public.inventory_movements'::regclass)),
  'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t where t.tgrelid in('public.inventory_balances'::regclass,'public.inventory_movements'::regclass)),
  'policies',(select jsonb_agg(to_jsonb(v) order by v.schemaname,v.tablename,v.policyname) from pg_policies v where v.schemaname='public' and v.tablename in('inventory_balances','inventory_movements'))
 ) into before_contract;
 body:=replace(p.prosrc,E'\r\n',E'\n');
 needle:=$direction$if new.movement_type='adjustment' and new.adjustment_direction not in('increase','decrease') then$direction$;
 if length(body)-length(replace(body,needle,''))<>length(needle) then
  raise exception 'inventory_outbound_direction_shape_changed' using errcode='55000';end if;
 patched:=replace(body,needle,$direction$if new.movement_type='adjustment' and (new.adjustment_direction is null or new.adjustment_direction not in('increase','decrease')) then$direction$);
 needle:=$insert$ insert into public.inventory_balances(tenant_id,location_id,client_id,item_description,quantity,pallet_count,weight_kg,volume_m3,first_inbound_at,last_movement_at)$insert$;
 if length(patched)-length(replace(patched,needle,''))<>length(needle) then
  raise exception 'inventory_outbound_insert_shape_changed' using errcode='55000';end if;
 patched:=replace(patched,needle,$outbound$ if sign<0 then
  update public.inventory_balances set
   quantity=quantity-new.quantity,
   pallet_count=pallet_count-coalesce(new.pallet_count,0),
   weight_kg=weight_kg-coalesce(new.weight_kg,0),
   volume_m3=volume_m3-coalesce(new.volume_m3,0),
   last_movement_at=new.moved_at,updated_at=now()
  where id=available.id and tenant_id=new.tenant_id;
  return new;
 end if;
 insert into public.inventory_balances(tenant_id,location_id,client_id,item_description,quantity,pallet_count,weight_kg,volume_m3,first_inbound_at,last_movement_at)$outbound$);
 execute replace(pg_get_functiondef(p.oid),p.prosrc,patched);
 select to_jsonb(f)-'prosrc' into after_metadata from pg_proc f where f.oid=p.oid;
 select jsonb_build_object(
  'constraints',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_constraint c where c.conrelid in('public.inventory_balances'::regclass,'public.inventory_movements'::regclass)),
  'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t where t.tgrelid in('public.inventory_balances'::regclass,'public.inventory_movements'::regclass)),
  'policies',(select jsonb_agg(to_jsonb(v) order by v.schemaname,v.tablename,v.policyname) from pg_policies v where v.schemaname='public' and v.tablename in('inventory_balances','inventory_movements'))
 ) into after_contract;
 if before_metadata is distinct from after_metadata or before_contract is distinct from after_contract
  or (select prosrc from pg_proc where oid=p.oid) is distinct from patched then
  raise exception 'inventory_outbound_metadata_or_contract_changed' using errcode='55000';end if;
end;$inventory_outbound$;
