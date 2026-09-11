-- Promote only the reviewed core, complete economic readers and reservation guards.
set lock_timeout='3s';
set statement_timeout='30s';
do $reviewed_dependencies$
declare spec record;p record;t text;
begin
 for spec in select * from (values
 ('finance_private.expense_cost_effective(uuid,uuid)','e0328bd06900f17657a6bbc985f491fa',true,false),
 ('finance_private.expense_cost_funding(uuid,uuid)','18ce78f3207d8f334f05c930d7434c30',true,false),
 ('finance_private.guard_cost_regularization_source()','dfdfb7d5a899cf4bcf94bf379179fd2b',true,false),
 ('finance_private.regularize_unloading_cost(jsonb)','6caa6b7a00eca156e99bdcba1a9a66f2',true,false),
 ('finance_private.unloading_cost_regularization_context(uuid,uuid,jsonb)','c3abcbc6593d94094cd4bcd3a51a10ea',true,false),
 ('finance_private.canonical_trip_costs(uuid,uuid)','cf55d4be0f4215a363e1724389e45b9a',true,false),
 ('finance_private.cost_dispositions(uuid,integer,text)','7ac7097f7cd269161cdfce861747ffa5',true,true),
 ('finance_private.expense_cost_coverage(uuid,uuid)','e03ebbe00144dbac0874cdb2c6e1a8e9',true,false),
 ('finance_private.list_expenses(uuid,jsonb)','1da933d23d3e2fbcf56c31b30337f2c8',true,true),
 ('finance_private.payable_effective_cost_evidence(uuid,uuid,jsonb)','0195ec87e071d7648aa2f8007ff28ac8',true,false),
 ('finance_private.payable_portfolio(uuid,jsonb,integer,text)','83054b85c8b68bce312dafc1b742dfb6',true,true),
 ('finance_private.require_expense_cost_coverage(uuid,uuid)','103fc14513a63c667323d022dd635630',true,false),
 ('finance_private.settlement_expense_context(uuid,uuid,integer)','2c3fe67a8f2e11da52e33ecf99a148d2',true,true)) v(signature,body_md5,security_definer,actor_execute) loop
  select * into p from pg_proc where oid=to_regprocedure(spec.signature);
  if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from spec.body_md5
   or p.prosecdef is distinct from spec.security_definer or p.proconfig is distinct from array['search_path=""']::text[]
   or has_function_privilege('authenticated',p.oid,'execute') is distinct from spec.actor_execute
   or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')
   or exists(select 1 from aclexplode(p.proacl) a where a.grantee<>p.proowner and a.grantee<>(select oid from pg_roles where rolname='authenticated'))
  then raise exception 'finance_regularization_dependency_changed: %',spec.signature using errcode='55000';end if;
 end loop;
 foreach t in array array['finance_private.expense_cost_amendments','public.finance_expense_allocations','public.finance_expense_cancellations','public.payables','public.payables_payments','public.finance_payable_movement_links','public.finance_payable_link_reversals','public.finance_movement_voids'] loop
  if not exists(select 1 from pg_trigger where tgrelid=to_regclass(t) and tgname='a_cost_regularization_guard' and tgenabled='O' and tgfoid=to_regprocedure('finance_private.guard_cost_regularization_source()'))
  then raise exception 'finance_regularization_reservation_guard_missing: %',t using errcode='55000';end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='finance_private.expense_cost_regularizations'::regclass and tgname='cost_regularization_chain' and tgenabled='O' and tgdeferrable and tginitdeferred)
 or not exists(select 1 from pg_trigger where tgrelid='finance_private.expense_cost_dispositions'::regclass and tgname='cost_disposition_chain' and tgenabled='O' and tgdeferrable and tginitdeferred)
 then raise exception 'finance_regularization_chain_guard_missing' using errcode='55000';end if;
end $reviewed_dependencies$;
create function finance_private.dispatch_unloading_cost_regularization(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform finance_private.require_access((_payload->>'tenant_id')::uuid);
 return finance_private.regularize_unloading_cost(_payload);
end$$;
create function public.regularize_finance_unloading_cost(_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select finance_private.dispatch_unloading_cost_regularization(_payload)$$;
create function finance_private.unloading_cost_regularization_preview(_tenant_id uuid,_charge_id uuid,_proposal jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare value jsonb;can_invoke boolean;
begin
 perform finance_private.require_access(_tenant_id);
 value:=finance_private.unloading_cost_regularization_context(_tenant_id,_charge_id,_proposal);
 if value->>'tenant_id' is distinct from _tenant_id::text or value->>'actor_id' is distinct from auth.uid()::text
  or value->>'charge_id' is distinct from _charge_id::text or value#>>'{effects,cost_after_cents}' is distinct from _proposal->>'amount_cents'
 then raise exception 'finance_cost_context_identity_invalid' using errcode='55000';end if;
 can_invoke:=has_function_privilege('authenticated','public.regularize_finance_unloading_cost(jsonb)','execute')
  and has_function_privilege('authenticated','finance_private.dispatch_unloading_cost_regularization(jsonb)','execute')
  and not has_function_privilege('authenticated','finance_private.regularize_unloading_cost(jsonb)','execute')
  and not has_function_privilege('anon','finance_private.regularize_unloading_cost(jsonb)','execute')
  and not has_function_privilege('service_role','finance_private.regularize_unloading_cost(jsonb)','execute');
 return (value-'_evidence')||jsonb_build_object('can_execute',value->>'eligible'='true' and value->>'can_regularize'='true' and can_invoke);
end$$;
create function public.preview_finance_unloading_cost_regularization(_tenant_id uuid,_charge_id uuid,_proposal jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.unloading_cost_regularization_preview(_tenant_id,_charge_id,_proposal)$$;
revoke all on function finance_private.dispatch_unloading_cost_regularization(jsonb),public.regularize_finance_unloading_cost(jsonb),finance_private.unloading_cost_regularization_preview(uuid,uuid,jsonb),public.preview_finance_unloading_cost_regularization(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.dispatch_unloading_cost_regularization(jsonb),public.regularize_finance_unloading_cost(jsonb),finance_private.unloading_cost_regularization_preview(uuid,uuid,jsonb),public.preview_finance_unloading_cost_regularization(uuid,uuid,jsonb) to authenticated;
