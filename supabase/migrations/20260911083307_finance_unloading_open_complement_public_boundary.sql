-- Promote reviewed open-complement correction; original funding remains reserved.
set lock_timeout='3s';
set statement_timeout='30s';
do $dependencies$
declare spec record;p record;
begin
 for spec in select * from (values
('finance_private.check_open_complement_chain()','179ff0060662c0abfbc745c5d53e2666','v',false),
('finance_private.correct_unloading_open_complement(jsonb)','d4444827f2e0140018a248c26a6df0c9','v',false),
('finance_private.expense_cost_effective(uuid,uuid)','03dc3252d3f8dfaefcf1c0dc789d1e73','s',false),
('finance_private.guard_open_complement_source()','712031e564fac4d33c4f56f591ad2cdd','v',false),
('finance_private.open_complement_source(uuid,uuid)','199f6f21d17aca428da688f27326882d','s',false),
('finance_private.unloading_open_complement_context(uuid,uuid,text)','e2a3c0217730b6e354aba59be90418fb','s',false)) v(signature,body_md5,volatility,actor_execute) loop
  select * into p from pg_proc where oid=to_regprocedure(spec.signature);
  if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from spec.body_md5
   or not p.prosecdef or p.provolatile::text is distinct from spec.volatility
   or p.proconfig is distinct from array['search_path=""']::text[]
   or has_function_privilege('authenticated',p.oid,'execute') is distinct from spec.actor_execute
   or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')
   or exists(select 1 from aclexplode(p.proacl) a where a.grantee<>p.proowner and a.grantee<>(select oid from pg_roles where rolname='authenticated'))
  then raise exception 'finance_open_complement_dependency_changed: %',spec.signature using errcode='55000';end if;
 end loop;
 for spec in select * from (values
('finance_private.expense_open_complement_amendments','preserve_open_complement','finance_private.preserve_event()',false,27),
('finance_private.expense_open_complement_amendments','check_open_complement_chain','finance_private.check_open_complement_chain()',true,5),
('public.payables','a_open_complement_payable','finance_private.guard_open_complement_source()',false,27),
('public.finance_expense_allocations','a_open_complement_allocation','finance_private.guard_open_complement_source()',false,31),
('public.finance_expense_cancellations','a_open_complement_cancellation','finance_private.guard_open_complement_source()',false,7),
('public.finance_movement_voids','a_open_complement_void','finance_private.guard_open_complement_source()',false,7),
('finance_private.expense_cost_amendments','a_open_complement_old_cost','finance_private.guard_open_complement_source()',false,7),
('finance_private.expense_cost_regularizations','a_open_complement_covered_cost','finance_private.guard_open_complement_source()',false,7))v(relation,name,signature,deferred,event_type) loop
  if not exists(select 1 from pg_trigger where tgrelid=to_regclass(spec.relation) and tgname=spec.name and tgenabled='O' and tgfoid=to_regprocedure(spec.signature) and tgdeferrable=spec.deferred and tginitdeferred=spec.deferred and tgtype=spec.event_type and tgqual is null and tgnargs=0)
  then raise exception 'finance_open_complement_guard_missing: %',spec.name using errcode='55000';end if;
 end loop;
end $dependencies$;
create function finance_private.dispatch_unloading_open_complement(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform finance_private.require_access((_payload->>'tenant_id')::uuid);
 return finance_private.correct_unloading_open_complement(_payload);
end$$;
create function public.correct_finance_unloading_open_complement(_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select finance_private.dispatch_unloading_open_complement(_payload)$$;
create function finance_private.unloading_open_complement_preview(_tenant_id uuid,_charge_id uuid,_amount_cents text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare value jsonb;can_invoke boolean;
begin
 perform finance_private.require_access(_tenant_id);
 value:=finance_private.unloading_open_complement_context(_tenant_id,_charge_id,_amount_cents);
 if value->>'tenant_id' is distinct from _tenant_id::text or value->>'actor_id' is distinct from auth.uid()::text
 or value->>'charge_id' is distinct from _charge_id::text or value#>>'{effects,cost_after_cents}' is distinct from _amount_cents
 then raise exception 'finance_open_complement_context_identity_invalid' using errcode='55000';end if;
 can_invoke:=has_function_privilege('authenticated','public.correct_finance_unloading_open_complement(jsonb)','execute')
 and has_function_privilege('authenticated','finance_private.dispatch_unloading_open_complement(jsonb)','execute')
 and not has_function_privilege('authenticated','finance_private.correct_unloading_open_complement(jsonb)','execute')
 and not has_function_privilege('anon','finance_private.correct_unloading_open_complement(jsonb)','execute')
 and not has_function_privilege('service_role','finance_private.correct_unloading_open_complement(jsonb)','execute');
 return (value-'_evidence')||jsonb_build_object('can_execute',value->>'eligible'='true' and value->>'can_correct'='true' and can_invoke);
end$$;
create function public.preview_finance_unloading_open_complement(_tenant_id uuid,_charge_id uuid,_amount_cents text) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.unloading_open_complement_preview(_tenant_id,_charge_id,_amount_cents)$$;
revoke all on function finance_private.dispatch_unloading_open_complement(jsonb),public.correct_finance_unloading_open_complement(jsonb),finance_private.unloading_open_complement_preview(uuid,uuid,text),public.preview_finance_unloading_open_complement(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.dispatch_unloading_open_complement(jsonb),public.correct_finance_unloading_open_complement(jsonb),finance_private.unloading_open_complement_preview(uuid,uuid,text),public.preview_finance_unloading_open_complement(uuid,uuid,text) to authenticated;
