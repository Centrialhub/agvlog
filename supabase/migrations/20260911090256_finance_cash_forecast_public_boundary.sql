set lock_timeout='3s';set statement_timeout='30s';
do $review$
declare spec record;p record;
begin
 for spec in select * from (values
('finance_private.cash_forecast_collect(uuid,date,date)','f05aa53d0b085c6d89f177234a65b24c',true,'s'),
('finance_private.cash_forecast_snapshot_summary(uuid,uuid)','f137173987218f4b010b2db993665fa1',true,'s'),
('finance_private.cash_forecast_source_page(uuid,date,date,uuid,text,integer,text)','6b9f4cc1f5547c6381808421fbe6c539',true,'s'),
('finance_private.cash_forecast_summary(jsonb,jsonb,jsonb)','dd033f6cc7580d367f7624786a97b790',false,'i'),
('finance_private.forecast_customer_credit_evidence(uuid,uuid)','0d52a40e865dba8396d54c1eaed99d90',true,'s'),
('finance_private.forecast_movement_evidence(uuid,uuid)','5ea1d66232a8b9337f2f7843c0c6ac9a',true,'s'),
('finance_private.list_cash_forecast_snapshots(uuid,integer,text)','043decb64c81cca8e77472948ef2d0f4',true,'s'),
('finance_private.preview_cash_forecast(uuid,date,date,text)','d3482d879a34b9637e2b09d3a9f9bbe5',true,'s'),
('finance_private.project_collected_cash_forecast(jsonb)','995d91c56dd8eb5bafdfeba5bd664896',false,'i'),
('finance_private.read_cash_forecast_snapshot(uuid,uuid)','01ce07b9e21b3a2d9c0207b335245823',true,'s'),
('finance_private.record_cash_forecast_snapshot(jsonb)','cd0eab6f23ecefa1c61cf976735318fb',true,'v'),
('finance_private.validate_forecast_json(jsonb,jsonb)','d7d58dc822008959464fa7fe1ac87415',false,'i'))v(signature,body_md5,security_definer,volatility) loop
 select * into p from pg_proc where oid=to_regprocedure(spec.signature);
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from spec.body_md5 or p.prosecdef is distinct from spec.security_definer or p.provolatile::text is distinct from spec.volatility or p.proconfig is distinct from array['search_path=""']::text[]
 or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')
 or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner)
 then raise exception 'finance_forecast_dependency_changed: %',spec.signature using errcode='55000';end if;
 end loop;
 if not exists(select 1 from pg_class where oid='finance_private.cash_forecast_snapshots'::regclass and relrowsecurity)
 or has_table_privilege('authenticated','finance_private.cash_forecast_snapshots','select,insert,update,delete') or has_table_privilege('anon','finance_private.cash_forecast_snapshots','select,insert,update,delete') or has_table_privilege('service_role','finance_private.cash_forecast_snapshots','select,insert,update,delete')
 or not exists(select 1 from pg_trigger where tgrelid='finance_private.cash_forecast_snapshots'::regclass and tgname='preserve_cash_forecast_snapshot' and tgfoid='finance_private.preserve_event()'::regprocedure and tgtype=27 and tgenabled='O' and tgqual is null and tgnargs=0)
 then raise exception 'finance_forecast_snapshot_guard_missing' using errcode='55000';end if;
end$review$;
create function finance_private.dispatch_cash_forecast_snapshot(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform finance_private.require_access((_payload->>'tenant_id')::uuid);return finance_private.record_cash_forecast_snapshot(_payload);end$$;
create function public.record_finance_cash_forecast(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.dispatch_cash_forecast_snapshot(_payload)$$;
create function finance_private.public_cash_forecast_preview(_tenant_id uuid,_cutoff date,_period_end date,_expected_revision text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare value jsonb;capable boolean;
begin
 perform finance_private.require_access(_tenant_id);value:=finance_private.preview_cash_forecast(_tenant_id,_cutoff,_period_end,_expected_revision);
 if value->>'tenant_id' is distinct from _tenant_id::text or value->>'actor_id' is distinct from auth.uid()::text then raise exception 'finance_forecast_collection_identity_invalid' using errcode='55000';end if;
 capable:=has_function_privilege('authenticated','public.record_finance_cash_forecast(jsonb)','execute') and has_function_privilege('authenticated','finance_private.dispatch_cash_forecast_snapshot(jsonb)','execute') and not has_function_privilege('authenticated','finance_private.record_cash_forecast_snapshot(jsonb)','execute');
 return value||jsonb_build_object('can_record',capable);
end$$;
create function public.preview_finance_cash_forecast(_tenant_id uuid,_cutoff date,_period_end date,_expected_revision text default null) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.public_cash_forecast_preview(_tenant_id,_cutoff,_period_end,_expected_revision)$$;
create function finance_private.public_cash_forecast_history(_tenant_id uuid,_page integer,_expected_revision text) returns jsonb language plpgsql stable security definer set search_path='' as $$begin perform finance_private.require_access(_tenant_id);return finance_private.list_cash_forecast_snapshots(_tenant_id,_page,_expected_revision);end$$;
create function public.get_finance_cash_forecast_history(_tenant_id uuid,_page integer,_expected_revision text) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.public_cash_forecast_history(_tenant_id,_page,_expected_revision)$$;
create function finance_private.public_cash_forecast_snapshot(_tenant_id uuid,_snapshot_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin perform finance_private.require_access(_tenant_id);return finance_private.cash_forecast_snapshot_summary(_tenant_id,_snapshot_id);end$$;
create function public.get_finance_cash_forecast_snapshot(_tenant_id uuid,_snapshot_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.public_cash_forecast_snapshot(_tenant_id,_snapshot_id)$$;
create function finance_private.public_cash_forecast_sources(_tenant_id uuid,_cutoff date,_period_end date,_snapshot_id uuid,_kind text,_page integer,_expected_revision text) returns jsonb language plpgsql stable security definer set search_path='' as $$begin perform finance_private.require_access(_tenant_id);return finance_private.cash_forecast_source_page(_tenant_id,_cutoff,_period_end,_snapshot_id,_kind,_page,_expected_revision);end$$;
create function public.get_finance_cash_forecast_sources(_tenant_id uuid,_cutoff date,_period_end date,_snapshot_id uuid,_kind text,_page integer,_expected_revision text) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.public_cash_forecast_sources(_tenant_id,_cutoff,_period_end,_snapshot_id,_kind,_page,_expected_revision)$$;
revoke all on function finance_private.dispatch_cash_forecast_snapshot(jsonb),public.record_finance_cash_forecast(jsonb),finance_private.public_cash_forecast_preview(uuid,date,date,text),public.preview_finance_cash_forecast(uuid,date,date,text),finance_private.public_cash_forecast_history(uuid,integer,text),public.get_finance_cash_forecast_history(uuid,integer,text),finance_private.public_cash_forecast_snapshot(uuid,uuid),public.get_finance_cash_forecast_snapshot(uuid,uuid),finance_private.public_cash_forecast_sources(uuid,date,date,uuid,text,integer,text),public.get_finance_cash_forecast_sources(uuid,date,date,uuid,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.dispatch_cash_forecast_snapshot(jsonb),public.record_finance_cash_forecast(jsonb),finance_private.public_cash_forecast_preview(uuid,date,date,text),public.preview_finance_cash_forecast(uuid,date,date,text),finance_private.public_cash_forecast_history(uuid,integer,text),public.get_finance_cash_forecast_history(uuid,integer,text),finance_private.public_cash_forecast_snapshot(uuid,uuid),public.get_finance_cash_forecast_snapshot(uuid,uuid),finance_private.public_cash_forecast_sources(uuid,date,date,uuid,text,integer,text),public.get_finance_cash_forecast_sources(uuid,date,date,uuid,text,integer,text) to authenticated;
