set lock_timeout='3s';set statement_timeout='30s';
-- Classify existing/new user decisions without rewriting the append-only audit records.
do $audit$declare p record;body text;needle text:='''identity_reviewed_manually'',''identity_review_reversed''';replacement text;begin
 select * into p from pg_proc where oid='finance_private.audit_events(uuid,jsonb)'::regprocedure;
 if md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from 'afb87498db64fe6bb94ac3694be66087' or not p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[] or not has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') then raise exception 'finance_manual_audit_predecessor_changed' using errcode='55000';end if;
 body:=pg_get_functiondef(p.oid);
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>2 then raise exception 'finance_manual_audit_predicates_changed' using errcode='55000';end if;
 replacement:='''unloading_cost_regularized'',''cost_disposition_return_recorded'',''unloading_open_complement_corrected'',''payable_approved_with_revision'',''cash_forecast_preserved'',''unloading_open_complement_extinguished'','||needle;
 execute replace(body,needle,replacement);
end$audit$;
