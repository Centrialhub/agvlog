-- SELECT-only. Run after212550/211800/213156/220847/224136, before arming30716.
-- Catalog evidence is not an authorization to activate or resume workers.
with required(signature) as(values
 ('finance_private.can_access(uuid)'),('finance_private.require_access(uuid)'),
 ('private.request_tenant_id()'),('private.is_request_tenant_member(uuid)'),
 ('finance_private.movement_correction_readiness()'),('finance_private.account_period_guards_ready()'),
 ('finance_private.expense_options(uuid,text,text,uuid,integer)'),
 ('private.trip_cargo_is_closed_v1(uuid,uuid)'),('private.driver_settlement_is_cargo_released_v1(uuid,uuid)'),
 ('finance_private.record_settlement_payment(jsonb)'),('public.apply_load_payment_command(jsonb)'),
 ('public.close_finance_account_period(jsonb)'),('public.reopen_finance_account_period(jsonb)'),
 ('finance_private.run_fiscal_queue(integer)'),('finance_private.run_automatic_reconciliation_queue()')
)
select r.signature,p.oid is not null exists,p.prosecdef,p.proconfig,p.provolatile,
 md5(replace(p.prosrc,E'\r\n',E'\n')) source_md5,
 case when p.oid is not null then has_function_privilege('authenticated',p.oid,'execute') end authenticated_execute,
 case when p.oid is not null then has_function_privilege('anon',p.oid,'execute') end anon_execute,
 case when p.oid is not null then has_function_privilege('service_role',p.oid,'execute') end service_execute
from required r left join pg_proc p on p.oid=to_regprocedure(r.signature) order by r.signature;

-- Execute this second SELECT only after the first confirms both functions exist.
select finance_private.movement_correction_readiness() movement_correction,
 finance_private.account_period_guards_ready() period_guards,
 (select prosrc=' select false; ' from pg_proc where oid='finance_private.can_access(uuid)'::regprocedure) staged_gate_exact,
 (select position('private.trip_cargo_is_closed_v1' in prosrc)>0 and position('from finance_private.active_movements movement' in prosrc)>0 and position('from public.finance_movements movement' in prosrc)=0 from pg_proc where oid='finance_private.expense_options(uuid,text,text,uuid,integer)'::regprocedure) cargo_and_active_candidates;

-- Privileged entry points need review of their complete call chain; booleans below
-- are search aids, never proof that permission is enforced on every path/replay.
select p.oid::regprocedure signature,p.prosecdef,p.proconfig,
 md5(pg_get_functiondef(p.oid)) definition_md5,
 has_function_privilege('authenticated',p.oid,'execute') authenticated_execute,
 has_function_privilege('anon',p.oid,'execute') anon_execute,
 position('require_access' in p.prosrc)>0 direct_require_access,
 position('can_access' in p.prosrc)>0 direct_can_access,
 position('finance_private.' in p.prosrc)>0 delegates_finance
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in('public','finance_private','expense_creation_private','settlement_adjustment_private')
 and p.prokind='f' and (p.proname~'(finance|receivable|payable|expense|settlement|payroll|load_payment)' or n.nspname<>'public')
 and (has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute'))
order by n.nspname,p.proname,p.oid;

-- Objects outside30716's table sweep remain explicit, especially views and rows
-- whose tenant is inherited through a parent ID. Review existing RLS/grants.
select n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relacl,
 exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='tenant_id' and a.atttypid='uuid'::regtype and not a.attisdropped) has_tenant_uuid,
 (select jsonb_agg(jsonb_build_object('name',p.polname,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))) from pg_policy p where p.polrelid=c.oid) policies
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in('public','private','finance_private','expense_creation_private','settlement_adjustment_private') and c.relkind in('r','p','v','m')
 and (c.relname~'^(finance_|bank_|financial_|payable|receivable|driver_expens|driver_settlement|payroll_|expense_creation_|expense_review_|settlement_adjustment_|client_invoice|closing_report)' or c.relname in('employee_advances','load_payments','load_unloading_charges'))
 and (n.nspname<>'public' or c.relkind not in('r','p') or not exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='tenant_id' and a.atttypid='uuid'::regtype and not a.attisdropped)) order by n.nspname,c.relname;
