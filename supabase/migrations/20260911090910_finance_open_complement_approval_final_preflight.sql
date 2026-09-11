-- Final validation of the integrated correction and revision-bound approval.
-- This migration changes no function, grant, trigger, or business record.
set lock_timeout='3s';
set statement_timeout='30s';
do $final_preflight$
declare spec record;p record;
begin
 for spec in select * from (values
('finance_private.check_open_complement_chain()','179ff0060662c0abfbc745c5d53e2666',true,'v',false),
('finance_private.correct_unloading_open_complement(jsonb)','d4444827f2e0140018a248c26a6df0c9',true,'v',false),
('finance_private.expense_cost_effective(uuid,uuid)','03dc3252d3f8dfaefcf1c0dc789d1e73',true,'s',false),
('finance_private.guard_open_complement_source()','712031e564fac4d33c4f56f591ad2cdd',true,'v',false),
('finance_private.open_complement_source(uuid,uuid)','199f6f21d17aca428da688f27326882d',true,'s',false),
('finance_private.unloading_open_complement_context(uuid,uuid,text)','e2a3c0217730b6e354aba59be90418fb',true,'s',false),
('public.approve_finance_payable(jsonb)','fb22a06d888b514ac17a5397962ad811',false,'v',true),
('finance_private.approve_payable_revision(jsonb)','178c5d334368ee2fcd4d9c7ff9910504',true,'v',false),
('finance_private.dispatch_payable_revision_approval(jsonb)','97836de12fc800d7f10e467ee2b9e263',true,'v',true),
('finance_private.guard_payable_revision_approval()','b221a4388773b4f9de274025249825e7',true,'v',false),
('finance_private.payable_approval_context(uuid,uuid)','d4afbd3294fc9c0edb4808a793ee9867',true,'s',false),
('finance_private.preview_payable_revision_approval(uuid,uuid)','1ba14c2bfffe00c1c1b9738375986f54',true,'s',true),
('public.preview_finance_payable_approval(uuid,uuid)','1ebaa64d384cadceecd4516815b33397',false,'s',true),
('finance_private.dispatch_unloading_open_complement(jsonb)','e707637a012fa092835dbc09e92600c7',true,'v',true),
('public.correct_finance_unloading_open_complement(jsonb)','4e5fd2d0da615fc259d93e469d7cd6c1',false,'v',true),
('finance_private.unloading_open_complement_preview(uuid,uuid,text)','5b57e7b07e4272a847c953a8d62cb8c7',true,'s',true),
('public.preview_finance_unloading_open_complement(uuid,uuid,text)','1adec352061bacd526f487a24d0f5e1c',false,'s',true)) v(signature,body_md5,is_definer,volatility,actor_execute) loop
  select * into p from pg_proc where oid=to_regprocedure(spec.signature);
  if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from spec.body_md5
   or p.prosecdef is distinct from spec.is_definer or p.provolatile::text is distinct from spec.volatility
   or p.proconfig is distinct from array['search_path=""']::text[]
   or has_function_privilege('authenticated',p.oid,'execute') is distinct from spec.actor_execute
   or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')
   or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner and (a.grantee<>(select oid from pg_roles where rolname='authenticated') or a.privilege_type<>'EXECUTE' or a.is_grantable))
  then raise exception 'finance_open_complement_final_contract_changed: %',spec.signature using errcode='55000';end if;
 end loop;
 for spec in select * from (values
('finance_private.expense_open_complement_amendments','preserve_open_complement','finance_private.preserve_event()',false,27),
('finance_private.expense_open_complement_amendments','check_open_complement_chain','finance_private.check_open_complement_chain()',true,5),
('public.payables','a_open_complement_payable','finance_private.guard_open_complement_source()',false,27),
('public.finance_expense_allocations','a_open_complement_allocation','finance_private.guard_open_complement_source()',false,31),
('public.finance_expense_cancellations','a_open_complement_cancellation','finance_private.guard_open_complement_source()',false,7),
('public.finance_movement_voids','a_open_complement_void','finance_private.guard_open_complement_source()',false,7),
('finance_private.expense_cost_amendments','a_open_complement_old_cost','finance_private.guard_open_complement_source()',false,7),
('finance_private.expense_cost_regularizations','a_open_complement_covered_cost','finance_private.guard_open_complement_source()',false,7),
('public.payables','a_payable_revision_approval','finance_private.guard_payable_revision_approval()',false,19))v(relation,name,signature,deferred,event_type) loop
  if not exists(select 1 from pg_trigger where tgrelid=to_regclass(spec.relation) and tgname=spec.name and tgenabled='O' and tgfoid=to_regprocedure(spec.signature) and tgdeferrable=spec.deferred and tginitdeferred=spec.deferred and tgtype=spec.event_type and tgqual is null and tgnargs=0)
  then raise exception 'finance_open_complement_guard_missing: %',spec.name using errcode='55000';end if;
 end loop;

 for spec in select unnest(array['finance_private.payable_approval_tickets','finance_private.expense_open_complement_amendments']) relation loop
  if not exists(select 1 from pg_class c where c.oid=to_regclass(spec.relation) and c.relrowsecurity and c.relkind='r'
   and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee<>c.relowner)
   and not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   and not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   and not has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
  then raise exception 'finance_open_complement_final_private_table_changed: %',spec.relation using errcode='55000';end if;
 end loop;
end $final_preflight$;
