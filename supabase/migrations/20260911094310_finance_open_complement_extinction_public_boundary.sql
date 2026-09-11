-- Public boundary after integrated extinction and recorded-return proof.
set lock_timeout='3s';
set statement_timeout='30s';
do $preflight$ declare s record;p record;begin
 for s in select * from(values
('finance_private.check_open_complement_chain()','179ff0060662c0abfbc745c5d53e2666','v'),
('finance_private.consume_complement_extinction_ticket()','b1d57dfd3a968418a4512e7f8355ddc0','v'),
('finance_private.cost_before_extinction_returns(uuid,uuid)','e0328bd06900f17657a6bbc985f491fa','s'),
('finance_private.expense_cost_before_open_complement(uuid,uuid)','de49565ea3e3325d16c4141e007a5311','s'),
('finance_private.expense_cost_before_returns(uuid,uuid)','e7ddcd545d16eed71be863c6a00ae8bc','s'),
('finance_private.expense_cost_coverage(uuid,uuid)','a2b095e60f0ce7badda5bfddc9b748fc','s'),
('finance_private.expense_cost_effective(uuid,uuid)','ccc7bf6e8ab7219267937dce14da760c','s'),
('finance_private.extinguish_open_unloading_complement(jsonb)','5f9a83c9b4e0ae11b1c16393c0673bdf','v'),
('finance_private.guard_cost_regularization_source()','dfdfb7d5a899cf4bcf94bf379179fd2b','v'),
('finance_private.guard_effective_unloading_cost()','fd0ba9ed44140afda72e537254a2ec8a','v'),
('finance_private.guard_open_complement_source()','dd488ce02e562da9c7a9247bc6dddf95','v'),
('finance_private.guard_payable_revision_approval()','b221a4388773b4f9de274025249825e7','v'),
('finance_private.open_complement_before_extinction(uuid,uuid)','2915ff2023730b766fdc9f9b8347d39d','s'),
('finance_private.open_complement_extinction_context(uuid,uuid,jsonb)','e1f9df5621fee337d584b3fc0253104c','s'))v(signature,hash,volatility) loop
 select * into p from pg_proc where oid=to_regprocedure(s.signature);
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from s.hash or not p.prosecdef or p.provolatile::text is distinct from s.volatility or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee<>p.proowner)
 or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') then raise exception 'finance_complement_extinction_public_predecessor_changed:%',s.signature using errcode='55000';end if;
 end loop;
 for s in select * from(values
('finance_expense_allocations','a_cost_regularization_guard','finance_private.guard_cost_regularization_source()',false,31),
('finance_expense_cancellations','a_cost_regularization_guard','finance_private.guard_cost_regularization_source()',false,7),
('finance_movement_voids','a_cost_regularization_guard','finance_private.guard_cost_regularization_source()',false,7),
('finance_payable_link_reversals','a_cost_regularization_guard','finance_private.guard_cost_regularization_source()',false,7),
('finance_payable_movement_links','a_cost_regularization_guard','finance_private.guard_cost_regularization_source()',false,7),
('finance_private.cost_disposition_returns','cost_return_capacity','finance_private.guard_cost_disposition_return()',false,7),
('finance_private.cost_disposition_returns','cost_return_chain','finance_private.check_cost_disposition_return()',true,5),
('finance_private.expense_cost_amendments','a_cost_regularization_guard','finance_private.guard_cost_regularization_source()',false,7),
('finance_private.expense_cost_regularizations','a_open_complement_covered_cost','finance_private.guard_open_complement_source()',false,7),
('finance_private.open_complement_extinctions','check_complement_extinction','finance_private.check_open_complement_chain()',true,5),
('finance_private.open_complement_extinctions','preserve_complement_extinction','finance_private.preserve_event()',false,27),
('payables','a_cost_regularization_guard','finance_private.guard_cost_regularization_source()',false,27),
('payables','a_open_complement_payable','finance_private.guard_open_complement_source()',false,27),
('payables','a_payable_revision_approval','finance_private.guard_payable_revision_approval()',false,19),
('payables','finance_effective_unloading_payable','finance_private.guard_effective_unloading_cost()',false,23),
('payables','zz_complement_extinction_ticket','finance_private.consume_complement_extinction_ticket()',false,19),
('payables_payments','a_cost_regularization_guard','finance_private.guard_cost_regularization_source()',false,31))v(relation,name,signature,deferred,event_type) loop
 if not exists(select 1 from pg_trigger where tgrelid=to_regclass(s.relation) and tgname=s.name and tgfoid=to_regprocedure(s.signature) and tgenabled='O' and tgtype=s.event_type and tgqual is null and tgnargs=0 and tgdeferrable=s.deferred and tginitdeferred=s.deferred) then raise exception 'finance_complement_extinction_public_guard_changed:%',s.name using errcode='55000';end if;
 end loop;
 for s in select unnest(array['finance_private.open_complement_extinctions','finance_private.expense_cost_tickets','finance_private.expense_cost_regularizations','finance_private.expense_cost_dispositions','finance_private.cost_disposition_returns']) relation loop
 if not exists(select 1 from pg_class c where c.oid=to_regclass(s.relation) and c.relkind='r' and c.relrowsecurity and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)) then raise exception 'finance_complement_extinction_public_table_changed:%',s.relation using errcode='55000';end if;
 end loop;
end$preflight$;
create function finance_private.dispatch_open_complement_extinction(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform finance_private.require_access((_payload->>'tenant_id')::uuid);
 return finance_private.extinguish_open_unloading_complement(_payload);
end$$;
create function public.extinguish_finance_open_complement(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.dispatch_open_complement_extinction(_payload)$$;
create function finance_private.preview_open_complement_extinction(_tenant_id uuid,_charge_id uuid,_proposal jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;can_invoke boolean;begin
 perform finance_private.require_access(_tenant_id);
 v:=finance_private.open_complement_extinction_context(_tenant_id,_charge_id,_proposal);
 if v->>'tenant_id' is distinct from _tenant_id::text or v->>'actor_id' is distinct from auth.uid()::text or v->>'charge_id' is distinct from _charge_id::text or v->'proposal' is distinct from _proposal or v#>>'{target,cost_cents}' is distinct from _proposal->>'amount_cents'
 or not exists(select 1 from public.finance_expense_items e where e.tenant_id=_tenant_id and e.unloading_id=_charge_id and e.id::text=v->>'expense_id' and e.payable_id::text=v->>'payable_id')
 then raise exception 'finance_complement_extinction_context_identity_invalid' using errcode='55000';end if;
 can_invoke:=has_function_privilege('authenticated','public.extinguish_finance_open_complement(jsonb)','execute') and has_function_privilege('authenticated','finance_private.dispatch_open_complement_extinction(jsonb)','execute') and not has_function_privilege('authenticated','finance_private.extinguish_open_unloading_complement(jsonb)','execute') and not has_function_privilege('anon','finance_private.extinguish_open_unloading_complement(jsonb)','execute') and not has_function_privilege('service_role','finance_private.extinguish_open_unloading_complement(jsonb)','execute');
 return (v-'_evidence')||jsonb_build_object('can_execute',v->>'eligible'='true' and v->>'can_correct'='true' and can_invoke);
end$$;
create function public.preview_finance_open_complement_extinction(_tenant_id uuid,_charge_id uuid,_proposal jsonb) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.preview_open_complement_extinction(_tenant_id,_charge_id,_proposal)$$;
revoke all on function finance_private.dispatch_open_complement_extinction(jsonb),public.extinguish_finance_open_complement(jsonb),finance_private.preview_open_complement_extinction(uuid,uuid,jsonb),public.preview_finance_open_complement_extinction(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.dispatch_open_complement_extinction(jsonb),public.extinguish_finance_open_complement(jsonb),finance_private.preview_open_complement_extinction(uuid,uuid,jsonb),public.preview_finance_open_complement_extinction(uuid,uuid,jsonb) to authenticated;
