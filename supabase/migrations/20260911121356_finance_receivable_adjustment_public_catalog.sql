-- Candidate public boundary. Exact core fingerprints verified before exposure.
set lock_timeout='3s';set statement_timeout='30s';
do $core_fingerprints$declare s record;p record;begin
 for s in select * from(values
('finance_private.assert_receivable_adjustment_period(uuid,uuid,date)','e047568a2e1aaa5a58547e047df4a76c',true,'s',false),
('finance_private.audit_events(uuid,jsonb)','50e5a5482c93a083adf0e78c64718243',true,'s',true),
('finance_private.customer_credit_application_context(uuid,uuid,uuid,text,uuid)','f241d56af6f5c090316e40440b374dc7',true,'s',false),
('finance_private.guard_receivable_balance_adjustment()','4296e366efa4441a8254af420f676eff',true,'v',false),
('finance_private.lock_receivable_adjustment_date_source(uuid,uuid)','45950be8518a7bbc6542357a0bee81cd',false,'v',false),
('finance_private.receivable_adjustment_binding(uuid,uuid)','dde949943fa172ff9d3dba05e276c1c7',false,'s',false),
('finance_private.receivable_adjustment_composition(jsonb)','c68f3512f047c0259dc3844c59754a8c',false,'i',false),
('finance_private.receivable_adjustment_date_source(uuid,uuid)','83b399d94de1a386e2bd6eb0bca99882',false,'s',false),
('finance_private.receivable_adjustment_evidence(uuid,uuid)','4eafcf6d0a88a1c343115df0bf086f8c',false,'s',false),
('finance_private.receivable_balance_adjustment_context(uuid,uuid,text,text,date,uuid)','18d45e4335cb08f605154c7fbd5ca399',true,'s',false),
('finance_private.receivable_balance_adjustment_history(uuid,uuid,jsonb)','f78c06d47b1dad1e9f9aff23a6e3d892',true,'s',false),
('finance_private.receivable_credit_list_fields(uuid,uuid)','9593eacddd8b1b40e7bbf40fc8f7a979',false,'s',false),
('finance_private.receivable_ledger_before_adjustments(uuid,uuid)','51dc0bea52d353a7b6407fb6faa50cf0',false,'s',false),
('finance_private.receivable_portfolio_summary(uuid,date,date,uuid)','a085958eddf2dd0ede52ab5ac5a32dea',true,'s',true),
('finance_private.record_receivable_balance_adjustment(jsonb)','87df7da5ac1773b707caa932c7d85774',true,'v',false),
('finance_private.release_receivable_customer_credits(uuid,uuid,text,uuid)','666967707f32bdebfa0470a7c8c5891e',true,'v',false),
('finance_private.reverse_receivable_balance_adjustments(uuid,uuid,text,uuid)','2800048907fd95eb8c195418f40de463',true,'v',false),
('finance_private.verify_receivable_balance_adjustment()','eef39da3e7be2ca9d6650d5e9ea11b1d',true,'v',false),
('public._guard_receivable_ledger()','53c2b64bb32ed0b64a0046ea3489bdef',true,'v',false),
('public._invoice_lifecycle_snapshot(uuid,uuid)','2de9bcba3ca0f9e059709ddef04db229',false,'s',false),
('public._receivable_financial_snapshot(uuid,uuid)','904d7c409cb01ce8b720f257baea21af',false,'s',false),
('public._receivable_ledger_evidence(uuid,uuid)','13a2dd644cfcc39fa528e07b6fa29bbf',false,'s',false),
('public.get_closing_report_action_context(uuid,uuid)','a86ff529603b68ad69ab9bd6f2e2da31',true,'v',true)
 )v(signature,hash,is_definer,volatility,auth_execute) loop
 select * into p from pg_proc where oid=to_regprocedure(s.signature);
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from s.hash or p.prosecdef is distinct from s.is_definer or p.provolatile::text is distinct from s.volatility or p.proconfig is distinct from array['search_path=""']::text[]
 or has_function_privilege('authenticated',p.oid,'execute') is distinct from s.auth_execute or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')
 or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee<>p.proowner and(not s.auth_execute or a.grantee<>(select oid from pg_roles where rolname='authenticated') or a.privilege_type<>'EXECUTE' or a.is_grantable)) then raise exception 'finance_adjustment_reviewed_core_changed:%',s.signature using errcode='55000';end if;
 end loop;
end$core_fingerprints$;
do $preflight$declare s record;p record;begin
 for s in select * from(values
 ('finance_private.receivable_balance_adjustment_context(uuid,uuid,text,text,date,uuid)','s'),
 ('finance_private.record_receivable_balance_adjustment(jsonb)','v'),
 ('finance_private.receivable_balance_adjustment_history(uuid,uuid,jsonb)','s'))v(signature,volatility) loop
 select * into p from pg_proc where oid=to_regprocedure(s.signature);
 if p.oid is null or not p.prosecdef or p.provolatile::text<>s.volatility or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee<>p.proowner) then raise exception 'finance_adjustment_boundary_predecessor_changed:%',s.signature using errcode='55000';end if;
 end loop;
 if not exists(select 1 from pg_class c where c.oid=to_regclass('finance_private.receivable_balance_adjustment_events') and c.relrowsecurity and c.relkind='r' and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)) then raise exception 'finance_adjustment_boundary_journal_changed' using errcode='55000';end if;
 for s in select * from(values
 ('preserve_receivable_balance_adjustment','finance_private.preserve_event()',27,false),
 ('guard_receivable_balance_adjustment','finance_private.guard_receivable_balance_adjustment()',7,false),
 ('verify_receivable_balance_adjustment','finance_private.verify_receivable_balance_adjustment()',5,true),
 ('recalc_receivable_balance_adjustment','public._recalc_receivable_received()',5,false),
 ('zz_sync_receivable_balance_adjustment','finance_private.sync_credit_application_projection()',5,false))v(name,signature,event_type,deferred) loop
 if not exists(select 1 from pg_trigger where tgrelid=to_regclass('finance_private.receivable_balance_adjustment_events') and tgname=s.name and tgfoid=to_regprocedure(s.signature) and tgtype=s.event_type and tgenabled='O' and tgqual is null and tgnargs=0 and tgdeferrable=s.deferred and tginitdeferred=s.deferred) then raise exception 'finance_adjustment_boundary_guard_changed:%',s.name using errcode='55000';end if;
 end loop;
end$preflight$;
create function finance_private.dispatch_receivable_adjustment(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform finance_private.require_access((_payload->>'tenant_id')::uuid);
 return finance_private.record_receivable_balance_adjustment(_payload);
end$$;
create function public.record_finance_receivable_adjustment(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.dispatch_receivable_adjustment(_payload)$$;
create function finance_private.preview_receivable_adjustment(_tenant_id uuid,_receivable_id uuid,_kind text,_amount_cents text,_effective_on date,_adjustment_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;can_invoke boolean;begin
 perform finance_private.require_access(_tenant_id);
 v:=finance_private.receivable_balance_adjustment_context(_tenant_id,_receivable_id,_kind,_amount_cents,_effective_on,_adjustment_id);
 if v->>'tenant_id' is distinct from _tenant_id::text or v->>'actor_id' is distinct from auth.uid()::text or v->>'receivable_id' is distinct from _receivable_id::text or v->>'kind' is distinct from _kind or v->>'amount_cents' is distinct from _amount_cents or v->>'effective_on' is distinct from _effective_on::text or v->>'adjustment_id' is distinct from _adjustment_id::text then raise exception 'finance_adjustment_preview_identity_invalid' using errcode='55000';end if;
 can_invoke:=has_function_privilege('authenticated','public.record_finance_receivable_adjustment(jsonb)','execute') and has_function_privilege('authenticated','finance_private.dispatch_receivable_adjustment(jsonb)','execute') and not has_function_privilege('authenticated','finance_private.record_receivable_balance_adjustment(jsonb)','execute') and not has_function_privilege('anon','finance_private.record_receivable_balance_adjustment(jsonb)','execute') and not has_function_privilege('service_role','finance_private.record_receivable_balance_adjustment(jsonb)','execute');
 return v||jsonb_build_object('can_execute',coalesce(v->'eligible'='true'::jsonb and v->'can_adjust'='true'::jsonb,false) and can_invoke);
end$$;
create function public.preview_finance_receivable_adjustment(_tenant_id uuid,_receivable_id uuid,_kind text,_amount_cents text,_effective_on date,_adjustment_id uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.preview_receivable_adjustment(_tenant_id,_receivable_id,_kind,_amount_cents,_effective_on,_adjustment_id)$$;
create function finance_private.receivable_adjustment_catalog(_tenant_id uuid,_receivable_id uuid,_query jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 perform finance_private.require_access(_tenant_id);
 return finance_private.receivable_balance_adjustment_history(_tenant_id,_receivable_id,_query);
end$$;
create function public.get_finance_receivable_adjustments(_tenant_id uuid,_receivable_id uuid,_query jsonb) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.receivable_adjustment_catalog(_tenant_id,_receivable_id,_query)$$;
revoke all on function finance_private.dispatch_receivable_adjustment(jsonb),public.record_finance_receivable_adjustment(jsonb),finance_private.preview_receivable_adjustment(uuid,uuid,text,text,date,uuid),public.preview_finance_receivable_adjustment(uuid,uuid,text,text,date,uuid),finance_private.receivable_adjustment_catalog(uuid,uuid,jsonb),public.get_finance_receivable_adjustments(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.dispatch_receivable_adjustment(jsonb),public.record_finance_receivable_adjustment(jsonb),finance_private.preview_receivable_adjustment(uuid,uuid,text,text,date,uuid),public.preview_finance_receivable_adjustment(uuid,uuid,text,text,date,uuid),finance_private.receivable_adjustment_catalog(uuid,uuid,jsonb),public.get_finance_receivable_adjustments(uuid,uuid,jsonb) to authenticated;
