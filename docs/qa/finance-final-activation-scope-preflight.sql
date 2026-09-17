-- Read-only activation scope inventory. Run at the same final checkpoint as
-- finance-final-activation-catalog-checkpoint.sql; review every exclusion.
select c.oid::regclass as relation,c.relrowsecurity,c.relforcerowsecurity,c.relacl,
 exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped and a.atttypid='uuid'::regtype) as selected_for_sweep,
 (select jsonb_agg(jsonb_build_object('name',p.polname,'permissive',p.polpermissive,'roles',p.polroles,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_policy p where p.polrelid=c.oid) as policies
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in('r','p')
 and (c.relname like 'finance\_%' escape '\' or c.relname ~ '^(bank_|financial_|payables($|_)|payable_|receivables($|_)|receivable_|driver_expens|driver_settlement|payroll_|expense_creation_|expense_review_|settlement_adjustment_|client_invoice|closing_report)'
  or c.relname in('employee_advances','load_payments','load_unloading_charges'))
order by c.relname;

select p.oid::regprocedure as identity,pg_get_functiondef(p.oid) as definition,p.proacl,p.proconfig
from pg_proc p where p.oid in(
 to_regprocedure('finance_private.can_access(uuid)'),to_regprocedure('finance_private.require_access(uuid)'),
 to_regprocedure('private.is_request_tenant_member(uuid)'),to_regprocedure('private.request_tenant_id()'));
