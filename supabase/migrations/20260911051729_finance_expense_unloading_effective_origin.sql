-- Preserve cost and original reimbursement, while showing the separately versioned collection right.
do $history$
declare p record;body text;needle text:='select p.*,coalesce((select jsonb_agg(';
begin
 select * into p from pg_proc where oid='finance_private.list_expenses(uuid,jsonb)'::regprocedure;body:=p.prosrc;
 if md5(body)<>'7c5a4bbcc93c27d541ade125f700ab30' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or position(needle in body)=0
 or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE') or not has_function_privilege('authenticated',p.oid,'EXECUTE')
 or exists(select 1 from aclexplode(p.proacl) a where a.grantee not in(p.proowner,'authenticated'::regrole::oid))
 then raise exception 'finance_expense_unloading_reader_contract_changed' using errcode='55000';end if;
 body:=replace(body,needle,'select p.*,case when p.unloading_id is null then null else finance_private.unloading_effective_origin(p.tenant_id,p.unloading_id) end unloading_origin,coalesce((select jsonb_agg(');
 execute format('create or replace function finance_private.list_expenses(_tenant uuid,_filters jsonb default ''{}'') returns jsonb language plpgsql stable security definer set search_path='''' as %L',body);
end $history$;
