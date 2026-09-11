-- Financial composition only: no title/payment columns or historical values change.
set lock_timeout='3s';set statement_timeout='30s';
do $pins$declare s record;p record;begin
 for s in select * from(values
('finance_private.receivable_portfolio_summary(uuid,date,date,uuid)','c8b19aabed3e3d0d0b308ffdd70355af',true,'s'),
('finance_private.receivables_page(uuid,text,text,uuid,date,date,integer)','61e9d3b32f1b7d32cd0f5aed8a1938b3',true,'s'),
('finance_private.receivables_page_by_origin(uuid,text,text,uuid,date,date,integer,text)','3f79b4f3874c2e2b00b6bea071d211ee',true,'s'),
('public.get_finance_receivable_portfolio_summary(uuid,date,date,uuid)','57ec337154e72f5fd37b0921453f3202',false,'s'),
('public.get_finance_receivables_page(uuid,text,text,uuid,date,date,integer)','70abc27d04ecd22155b4287114666e9d',false,'s'),
('public.get_finance_receivables_page_by_origin(uuid,text,text,uuid,date,date,integer,text)','dee21e6ae2e9d39a4452929de62522e6',false,'s')
 )v(signature,hash,is_definer,volatility) loop
 select * into p from pg_proc where oid=to_regprocedure(s.signature);
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from s.hash or p.prosecdef is distinct from s.is_definer or p.provolatile::text is distinct from s.volatility or p.proconfig is distinct from array['search_path=""']::text[] or not has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee<>p.proowner and(a.grantee<>(select oid from pg_roles where rolname='authenticated') or a.privilege_type<>'EXECUTE' or a.is_grantable)) then raise exception 'finance_credit_portfolio_predecessor_changed:%',s.signature using errcode='55000';end if;
 end loop;
end$pins$;
create function finance_private.receivable_credit_list_fields(_tenant uuid,_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare s jsonb;valid boolean;begin
 s:=public._receivable_financial_snapshot(_tenant,_id);valid:=s->'requires_reconciliation'='false'::jsonb and nullif(s->>'fiscal_block_reason','') is null;
 return jsonb_build_object('cash_received_cents',case when valid then s->>'cash_received_cents' end,'credit_applied_cents',case when valid then s->>'credit_applied_cents' end,'settled_cents',case when valid then s->>'settled_cents' end,'open_cents',case when valid then s->>'open_cents' end);
end$$;
revoke all on function finance_private.receivable_credit_list_fields(uuid,uuid) from public,anon,authenticated,service_role;
do $pages$declare sig text;body text;needle text;begin
 foreach sig in array array['finance_private.receivables_page(uuid,text,text,uuid,date,date,integer)','finance_private.receivables_page_by_origin(uuid,text,text,uuid,date,date,integer,text)'] loop
 select pg_get_functiondef(to_regprocedure(sig)) into body;
 needle:='jsonb_agg(to_jsonb(p) order by p.created_at desc nulls last,p.id desc)';
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'finance_credit_list_composition_contract_changed';end if;
 body:=replace(body,needle,'jsonb_agg(to_jsonb(p)||finance_private.receivable_credit_list_fields(_tenant,p.id) order by p.created_at desc nulls last,p.id desc)');execute body;
 end loop;
end$pages$;
do $portfolio$declare body text;spec record;begin
 select pg_get_functiondef('finance_private.receivable_portfolio_summary(uuid,date,date,uuid)'::regprocedure) into body;
 for spec in select * from(values
 ('case when valid then trunc(coalesce(received_amount,0)*100) end allocated,','case when valid then trunc(coalesce(received_amount,0)*100) end allocated,case when valid then (snapshot->>''cash_received_cents'')::numeric end cash_received,case when valid then (snapshot->>''credit_applied_cents'')::numeric end credit_applied,'),
 ('coalesce(sum(allocated),0) allocated,','coalesce(sum(allocated),0) allocated,coalesce(sum(cash_received),0) cash_received,coalesce(sum(credit_applied),0) credit_applied,'),
 ('sum(allocated) allocated,sum(remaining) remaining','sum(allocated) allocated,sum(cash_received) cash_received,sum(credit_applied) credit_applied,sum(remaining) remaining'),
 ('''received_allocated_cents'',case when s.invalid=0 then s.allocated::text end,','''received_allocated_cents'',case when s.invalid=0 then s.allocated::text end,''cash_received_cents'',case when s.invalid=0 then s.cash_received::text end,''credit_applied_cents'',case when s.invalid=0 then s.credit_applied::text end,''settled_cents'',case when s.invalid=0 then s.allocated::text end,'),
 ('''received_allocated_cents'',case when s.invalid=0 then g.allocated::text end,','''received_allocated_cents'',case when s.invalid=0 then g.allocated::text end,''cash_received_cents'',case when s.invalid=0 then g.cash_received::text end,''credit_applied_cents'',case when s.invalid=0 then g.credit_applied::text end,''settled_cents'',case when s.invalid=0 then g.allocated::text end,')
 )v(needle,replacement) loop
 if (length(body)-length(replace(body,spec.needle,'')))/length(spec.needle)<>1 then raise exception 'finance_credit_portfolio_composition_contract_changed';end if;body:=replace(body,spec.needle,spec.replacement);
 end loop;execute body;
end$portfolio$;
