-- Promotion of the reviewed agenda; raw writer and journal remain private.
set lock_timeout='3s';set statement_timeout='30s';
do $pins$declare s record;p record;begin
 for s in select * from(values
('finance_private.audit_events(uuid,jsonb)','e2ec37aa8997d9a175d003d742f9fb2e',true,'s',true),
('finance_private.cash_forecast_agenda_preview(uuid,date,date,text)','ee53aa23fb2af973e3a56efee9bd2cbc',true,'s',false),
('finance_private.cash_forecast_collect(uuid,date,date)','0f9dfc28159c7012d5d241d60fbd42b6',true,'s',false),
('finance_private.cash_forecast_collect_before_agenda(uuid,date,date)','f05aa53d0b085c6d89f177234a65b24c',true,'s',false),
('finance_private.forecast_agenda_projection_input(jsonb)','591e66e2777c9ebee7e19e12b8fa18c1',false,'i',false),
('finance_private.preserve_event()','3b84ce910686158db38ac0dd79705a92',false,'v',false),
('finance_private.project_collected_cash_forecast(jsonb)','115992c8873fb0b3a901308189cf4860',false,'i',false),
('finance_private.record_cash_forecast_agenda(jsonb)','79c68ce49f0211287a460a3937a73607',true,'v',false))v(signature,hash,is_definer,volatility,actor_execute) loop
 select * into p from pg_proc where oid=to_regprocedure(s.signature);
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from s.hash or p.prosecdef is distinct from s.is_definer or p.provolatile::text is distinct from s.volatility or p.proconfig is distinct from array['search_path=""']::text[]
 or has_function_privilege('authenticated',p.oid,'execute') is distinct from s.actor_execute or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')
 or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee<>p.proowner and (a.grantee<>(select oid from pg_roles where rolname='authenticated') or a.privilege_type<>'EXECUTE' or a.is_grantable)) then raise exception 'finance_forecast_agenda_public_contract_changed:%',s.signature using errcode='55000';end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='finance_private.cash_forecast_agenda_events'::regclass and tgname='preserve_cash_forecast_agenda' and tgfoid='finance_private.preserve_event()'::regprocedure and tgtype=27 and tgenabled='O' and tgqual is null and tgnargs=0 and not tgdeferrable and not tginitdeferred) then raise exception 'finance_forecast_agenda_public_guard_changed' using errcode='55000';end if;
 if not exists(select 1 from pg_class c where c.oid='finance_private.cash_forecast_agenda_events'::regclass and c.relrowsecurity and c.relkind='r' and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)) then raise exception 'finance_forecast_agenda_public_journal_changed' using errcode='55000';end if;
end$pins$;
create function finance_private.dispatch_cash_forecast_agenda(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform finance_private.require_access((_payload->>'tenant_id')::uuid);
 return finance_private.record_cash_forecast_agenda(_payload);
end$$;
create function public.record_finance_cash_forecast_agenda(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.dispatch_cash_forecast_agenda(_payload)$$;
create function finance_private.preview_cash_forecast_agenda(_tenant_id uuid,_cutoff date,_period_end date,_economic_key text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;can_invoke boolean;begin
 perform finance_private.require_access(_tenant_id);
 v:=finance_private.cash_forecast_agenda_preview(_tenant_id,_cutoff,_period_end,_economic_key);
 if v->>'tenant_id' is distinct from _tenant_id::text or v->>'actor_id' is distinct from auth.uid()::text or v->>'cutoff' is distinct from _cutoff::text or v->>'period_end' is distinct from _period_end::text or v#>>'{origin,economic_key}' is distinct from _economic_key then raise exception 'finance_forecast_agenda_context_identity_invalid' using errcode='55000';end if;
 can_invoke:=has_function_privilege('authenticated','public.record_finance_cash_forecast_agenda(jsonb)','execute') and has_function_privilege('authenticated','finance_private.dispatch_cash_forecast_agenda(jsonb)','execute') and not has_function_privilege('authenticated','finance_private.record_cash_forecast_agenda(jsonb)','execute') and not has_function_privilege('anon','finance_private.record_cash_forecast_agenda(jsonb)','execute') and not has_function_privilege('service_role','finance_private.record_cash_forecast_agenda(jsonb)','execute');
 return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'cutoff',_cutoff,'period_end',_period_end,'revision',v->'revision','origin',v->'origin','eligible',v->'eligible','can_execute',v->>'eligible'='true' and can_invoke);
end$$;
create function public.preview_finance_cash_forecast_agenda(_tenant_id uuid,_cutoff date,_period_end date,_economic_key text) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.preview_cash_forecast_agenda(_tenant_id,_cutoff,_period_end,_economic_key)$$;
revoke all on function finance_private.dispatch_cash_forecast_agenda(jsonb),public.record_finance_cash_forecast_agenda(jsonb),finance_private.preview_cash_forecast_agenda(uuid,date,date,text),public.preview_finance_cash_forecast_agenda(uuid,date,date,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.dispatch_cash_forecast_agenda(jsonb),public.record_finance_cash_forecast_agenda(jsonb),finance_private.preview_cash_forecast_agenda(uuid,date,date,text),public.preview_finance_cash_forecast_agenda(uuid,date,date,text) to authenticated;
