-- Reviewed return core only; records an existing incoming movement, never transfers money.
set lock_timeout='3s';
set statement_timeout='30s';
do $dependencies$
declare spec record;p record;
begin
 for spec in select * from (values
('finance_private.check_cost_disposition_return()','fbd259b34a8ac55ec0271e3b6a5f5cf8','v',false),
('finance_private.cost_disposition_return_context(uuid,uuid,uuid,text)','66b093bd5759ea47a87cfcffcae78048','s',false),
('finance_private.cost_dispositions(uuid,integer,text)','c95bf921f4144a9d225d282cb57bef9c','s',true),
('finance_private.cost_return_movement_options(uuid,uuid,text,integer,text)','33189cc4ecd61d31602f94c349aaae92','s',false),
('finance_private.expense_cost_coverage(uuid,uuid)','8c9ee6819131d28a86b015d234dfe4ef','s',false),
('finance_private.expense_cost_effective(uuid,uuid)','de49565ea3e3325d16c4141e007a5311','s',false),
('finance_private.guard_cost_disposition_return()','789d12a626b189ec4aaba999ade71cbf','v',false),
('finance_private.receipt_movement_used_cents(uuid,uuid)','09ac7f454ff10e20328534f3c2dd236e','s',false),
('finance_private.record_cost_disposition_return(jsonb)','678cbaa8029ff25d022354086f1d0528','v',false),
('finance_private.unloading_cost_regularization_context(uuid,uuid,jsonb)','438852b7075d393eb49a9255fb23c9d7','s',false)) v(signature,body_md5,volatility,actor_execute) loop
  select * into p from pg_proc where oid=to_regprocedure(spec.signature);
  if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from spec.body_md5
   or not p.prosecdef or p.provolatile::text is distinct from spec.volatility
   or p.proconfig is distinct from array['search_path=""']::text[]
   or has_function_privilege('authenticated',p.oid,'execute') is distinct from spec.actor_execute
   or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')
   or exists(select 1 from aclexplode(p.proacl) a where a.grantee<>p.proowner and a.grantee<>(select oid from pg_roles where rolname='authenticated'))
  then raise exception 'finance_cost_return_dependency_changed: %',spec.signature using errcode='55000';end if;
 end loop;
 for spec in select * from (values
 ('finance_private.cost_disposition_returns','cost_return_capacity','finance_private.guard_cost_disposition_return()',false,7),
 ('finance_private.cost_disposition_returns','cost_return_chain','finance_private.check_cost_disposition_return()',true,5),
 ('finance_private.cost_disposition_returns','preserve_cost_disposition_return','finance_private.preserve_event()',false,27),
 ('public.finance_movement_voids','a_cost_return_guard','finance_private.guard_cost_disposition_return()',false,7),
 ('finance_private.expense_cost_regularizations','a_cost_return_guard','finance_private.guard_cost_disposition_return()',false,7))v(relation,name,signature,deferred,event_type) loop
  if not exists(select 1 from pg_trigger where tgrelid=to_regclass(spec.relation) and tgname=spec.name and tgenabled='O' and tgfoid=to_regprocedure(spec.signature) and tgdeferrable=spec.deferred and tginitdeferred=spec.deferred and tgtype=spec.event_type and tgqual is null and tgnargs=0)
  then raise exception 'finance_cost_return_guard_missing: %',spec.name using errcode='55000';end if;
 end loop;
end $dependencies$;
create function finance_private.dispatch_cost_disposition_return(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform finance_private.require_access((_payload->>'tenant_id')::uuid);
 return finance_private.record_cost_disposition_return(_payload);
end$$;
create function public.record_finance_cost_disposition_return(_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select finance_private.dispatch_cost_disposition_return(_payload)$$;
create function finance_private.cost_disposition_return_preview(_tenant_id uuid,_disposition_id uuid,_incoming_movement_id uuid,_amount_cents text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare value jsonb;can_invoke boolean;
begin
 perform finance_private.require_access(_tenant_id);
 value:=finance_private.cost_disposition_return_context(_tenant_id,_disposition_id,_incoming_movement_id,_amount_cents);
 if value->>'tenant_id' is distinct from _tenant_id::text or value->>'actor_id' is distinct from auth.uid()::text
  or value->>'disposition_id' is distinct from _disposition_id::text
  or value#>>'{incoming,movement_id}' is distinct from _incoming_movement_id::text
  or value#>>'{effects,amount_cents}' is distinct from _amount_cents
 then raise exception 'finance_cost_return_context_identity_invalid' using errcode='55000';end if;
 can_invoke:=has_function_privilege('authenticated','public.record_finance_cost_disposition_return(jsonb)','execute')
  and has_function_privilege('authenticated','finance_private.dispatch_cost_disposition_return(jsonb)','execute')
  and not has_function_privilege('authenticated','finance_private.record_cost_disposition_return(jsonb)','execute')
  and not has_function_privilege('anon','finance_private.record_cost_disposition_return(jsonb)','execute')
  and not has_function_privilege('service_role','finance_private.record_cost_disposition_return(jsonb)','execute');
 return (value-'_evidence')||jsonb_build_object('can_execute',value->>'eligible'='true' and value->>'can_record'='true' and can_invoke);
end$$;
create function public.preview_finance_cost_disposition_return(_tenant_id uuid,_disposition_id uuid,_incoming_movement_id uuid,_amount_cents text) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.cost_disposition_return_preview(_tenant_id,_disposition_id,_incoming_movement_id,_amount_cents)$$;
create function finance_private.cost_return_movement_options_public(_tenant_id uuid,_disposition_id uuid,_query text,_page integer,_expected_revision text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare value jsonb;
begin
 perform finance_private.require_access(_tenant_id);
 value:=finance_private.cost_return_movement_options(_tenant_id,_disposition_id,_query,_page,_expected_revision);
 if value->>'tenant_id' is distinct from _tenant_id::text or value->>'actor_id' is distinct from auth.uid()::text or value->>'disposition_id' is distinct from _disposition_id::text
 then raise exception 'finance_cost_return_context_identity_invalid' using errcode='55000';end if;
 return value;
end$$;
create function public.get_finance_cost_return_movement_options(_tenant_id uuid,_disposition_id uuid,_query text default '',_page integer default 1,_expected_revision text default null) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.cost_return_movement_options_public(_tenant_id,_disposition_id,_query,_page,_expected_revision)$$;
revoke all on function finance_private.dispatch_cost_disposition_return(jsonb),public.record_finance_cost_disposition_return(jsonb),finance_private.cost_disposition_return_preview(uuid,uuid,uuid,text),public.preview_finance_cost_disposition_return(uuid,uuid,uuid,text),finance_private.cost_return_movement_options_public(uuid,uuid,text,integer,text),public.get_finance_cost_return_movement_options(uuid,uuid,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.dispatch_cost_disposition_return(jsonb),public.record_finance_cost_disposition_return(jsonb),finance_private.cost_disposition_return_preview(uuid,uuid,uuid,text),public.preview_finance_cost_disposition_return(uuid,uuid,uuid,text),finance_private.cost_return_movement_options_public(uuid,uuid,text,integer,text),public.get_finance_cost_return_movement_options(uuid,uuid,text,integer,text) to authenticated;
