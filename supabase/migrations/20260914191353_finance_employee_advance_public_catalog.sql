-- Public Data API boundary for the audited employee-advance lifecycle.
set lock_timeout='3s';
set statement_timeout='30s';

do $preflight$declare x record;p record;begin
 for x in select * from(values
  ('finance_private.record_employee_advance(jsonb)','a8e3d6176f52baee8b8b619d181bc859','v'),
  ('finance_private.employee_advance_action_context(uuid,uuid,text)','3801bb57d911a9269c2f78fe4d0a8b1c','s'),
  ('finance_private.apply_employee_advance_action(jsonb)','51fcccca4f4f54a75ecb3b098b3bd1b5','v'),
  ('finance_private.employee_advance_payment_context(uuid,uuid,uuid,text)','52eae77e1ecb0ce0cbf3f47c8d6afb6a','s'),
  ('finance_private.record_employee_advance_payment(jsonb)','d6409fdb69f6cb30c19a37f2baef855f','v'),
  ('finance_private.employee_advance_payment_options(uuid,uuid,jsonb)','12c59261dab9a7311d094eb4f108cc5a','s'),
  ('finance_private.employee_advance_payment_history(uuid,uuid,jsonb)','337921a1b9021206dd3835ada1d94a1c','s')
 )v(signature,hash,volatility) loop
  select * into p from pg_proc where oid=to_regprocedure(x.signature);
  if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from x.hash or not p.prosecdef or p.provolatile::text is distinct from x.volatility or p.proconfig is distinct from array['search_path=""']::text[]
   or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee<>p.proowner)
  then raise exception 'finance_advance_public_predecessor_changed:%',x.signature using errcode='55000';end if;
 end loop;
 if not exists(select 1 from pg_class where oid='public.employee_advances'::regclass and relrowsecurity)
  or has_table_privilege('anon','public.employee_advances','insert') or has_table_privilege('anon','public.employee_advances','update') or has_table_privilege('anon','public.employee_advances','delete')
  or has_table_privilege('authenticated','public.employee_advances','insert') or has_table_privilege('authenticated','public.employee_advances','update') or has_table_privilege('authenticated','public.employee_advances','delete')
  or has_function_privilege('anon','public.register_employee_advance(uuid,uuid,numeric,date,text,text,text,boolean,boolean)','execute')
  or has_function_privilege('authenticated','public.register_employee_advance(uuid,uuid,numeric,date,text,text,text,boolean,boolean)','execute')
 then raise exception 'finance_advance_public_direct_access_changed' using errcode='55000';end if;
end$preflight$;

create function finance_private.employee_advance_public_runtime_ready(kind text) returns boolean
language sql stable security definer set search_path='' as $$
 select case kind
  when 'registration' then
   has_function_privilege('authenticated','public.record_finance_employee_advance(jsonb)','execute')
   and has_function_privilege('authenticated','finance_private.dispatch_employee_advance_registration(jsonb)','execute')
   and not has_function_privilege('authenticated','finance_private.record_employee_advance(jsonb)','execute')
  when 'payment' then
   has_function_privilege('authenticated','public.preview_finance_employee_advance_payment(uuid,uuid,uuid,text)','execute')
   and has_function_privilege('authenticated','public.record_finance_employee_advance_payment(jsonb)','execute')
   and has_function_privilege('authenticated','finance_private.preview_employee_advance_payment(uuid,uuid,uuid,text)','execute')
   and has_function_privilege('authenticated','finance_private.dispatch_employee_advance_payment(jsonb)','execute')
   and not has_function_privilege('authenticated','finance_private.record_employee_advance_payment(jsonb)','execute')
  when 'action' then
   has_function_privilege('authenticated','public.preview_finance_employee_advance_action(uuid,uuid,text)','execute')
   and has_function_privilege('authenticated','public.apply_finance_employee_advance_action(jsonb)','execute')
   and has_function_privilege('authenticated','finance_private.preview_employee_advance_action(uuid,uuid,text)','execute')
   and has_function_privilege('authenticated','finance_private.dispatch_employee_advance_action(jsonb)','execute')
   and not has_function_privilege('authenticated','finance_private.apply_employee_advance_action(jsonb)','execute')
  else false end
  and not has_function_privilege('anon','finance_private.record_employee_advance(jsonb)','execute')
  and not has_function_privilege('anon','finance_private.record_employee_advance_payment(jsonb)','execute')
  and not has_function_privilege('anon','finance_private.apply_employee_advance_action(jsonb)','execute')
  and not has_function_privilege('service_role','finance_private.record_employee_advance(jsonb)','execute')
  and not has_function_privilege('service_role','finance_private.record_employee_advance_payment(jsonb)','execute')
  and not has_function_privilege('service_role','finance_private.apply_employee_advance_action(jsonb)','execute')
$$;

create function finance_private.dispatch_employee_advance_registration(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 perform finance_private.require_access((_payload->>'tenant_id')::uuid);
 if not finance_private.employee_advance_public_runtime_ready('registration') then raise exception 'finance_advance_registration_public_boundary_unavailable' using errcode='55000';end if;
 return finance_private.record_employee_advance(_payload);
end$$;
create function public.record_finance_employee_advance(_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select finance_private.dispatch_employee_advance_registration(_payload)$$;

create function finance_private.preview_employee_advance_payment(_tenant_id uuid,_advance_id uuid,_movement_id uuid,_amount_cents text) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare v jsonb;begin
 perform finance_private.require_access(_tenant_id);
 v:=finance_private.employee_advance_payment_context(_tenant_id,_advance_id,_movement_id,_amount_cents);
 if v->>'tenant_id' is distinct from _tenant_id::text or v->>'actor_id' is distinct from auth.uid()::text or v->>'advance_id' is distinct from _advance_id::text or v->>'movement_id' is distinct from _movement_id::text or v->>'amount_cents' is distinct from _amount_cents
 then raise exception 'finance_advance_payment_preview_identity_invalid' using errcode='55000';end if;
 return v||jsonb_build_object('can_execute',coalesce((v->>'eligible')::boolean,false) and coalesce((v->>'can_pay')::boolean,false) and finance_private.employee_advance_public_runtime_ready('payment'));
end$$;
create function public.preview_finance_employee_advance_payment(_tenant_id uuid,_advance_id uuid,_movement_id uuid,_amount_cents text) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.preview_employee_advance_payment(_tenant_id,_advance_id,_movement_id,_amount_cents)$$;

create function finance_private.dispatch_employee_advance_payment(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 perform finance_private.require_access((_payload->>'tenant_id')::uuid);
 if not finance_private.employee_advance_public_runtime_ready('payment') then raise exception 'finance_advance_payment_public_boundary_unavailable' using errcode='55000';end if;
 return finance_private.record_employee_advance_payment(_payload);
end$$;
create function public.record_finance_employee_advance_payment(_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select finance_private.dispatch_employee_advance_payment(_payload)$$;

create function finance_private.read_employee_advance_payment_options(_tenant_id uuid,_advance_id uuid,_query jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare v jsonb;begin
 perform finance_private.require_access(_tenant_id);v:=finance_private.employee_advance_payment_options(_tenant_id,_advance_id,_query);
 if v->>'tenant_id' is distinct from _tenant_id::text or v->>'actor_id' is distinct from auth.uid()::text or v->>'advance_id' is distinct from _advance_id::text then raise exception 'finance_advance_payment_options_identity_invalid' using errcode='55000';end if;return v;
end$$;
create function public.get_finance_employee_advance_payment_options(_tenant_id uuid,_advance_id uuid,_query jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.read_employee_advance_payment_options(_tenant_id,_advance_id,_query)$$;

create function finance_private.read_employee_advance_payment_history(_tenant_id uuid,_advance_id uuid,_query jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare v jsonb;begin
 perform finance_private.require_access(_tenant_id);v:=finance_private.employee_advance_payment_history(_tenant_id,_advance_id,_query);
 if v->>'tenant_id' is distinct from _tenant_id::text or v->>'actor_id' is distinct from auth.uid()::text or v->>'advance_id' is distinct from _advance_id::text then raise exception 'finance_advance_payment_history_identity_invalid' using errcode='55000';end if;return v;
end$$;
create function public.get_finance_employee_advance_payment_history(_tenant_id uuid,_advance_id uuid,_query jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.read_employee_advance_payment_history(_tenant_id,_advance_id,_query)$$;

create function finance_private.preview_employee_advance_action(_tenant_id uuid,_advance_id uuid,_action text) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare v jsonb;begin
 perform finance_private.require_access(_tenant_id);v:=finance_private.employee_advance_action_context(_tenant_id,_advance_id,_action);
 if v->>'tenant_id' is distinct from _tenant_id::text or v->>'actor_id' is distinct from auth.uid()::text or v->>'advance_id' is distinct from _advance_id::text or v->>'action' is distinct from _action then raise exception 'finance_advance_action_preview_identity_invalid' using errcode='55000';end if;
 return v||jsonb_build_object('can_execute',coalesce((v->>'eligible')::boolean,false) and coalesce((v->>'can_manage')::boolean,false) and finance_private.employee_advance_public_runtime_ready('action'));
end$$;
create function public.preview_finance_employee_advance_action(_tenant_id uuid,_advance_id uuid,_action text) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.preview_employee_advance_action(_tenant_id,_advance_id,_action)$$;

create function finance_private.dispatch_employee_advance_action(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 perform finance_private.require_access((_payload->>'tenant_id')::uuid);
 if not finance_private.employee_advance_public_runtime_ready('action') then raise exception 'finance_advance_action_public_boundary_unavailable' using errcode='55000';end if;
 return finance_private.apply_employee_advance_action(_payload);
end$$;
create function public.apply_finance_employee_advance_action(_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select finance_private.dispatch_employee_advance_action(_payload)$$;

revoke all on function finance_private.employee_advance_public_runtime_ready(text),finance_private.dispatch_employee_advance_registration(jsonb),public.record_finance_employee_advance(jsonb),finance_private.preview_employee_advance_payment(uuid,uuid,uuid,text),public.preview_finance_employee_advance_payment(uuid,uuid,uuid,text),finance_private.dispatch_employee_advance_payment(jsonb),public.record_finance_employee_advance_payment(jsonb),finance_private.read_employee_advance_payment_options(uuid,uuid,jsonb),public.get_finance_employee_advance_payment_options(uuid,uuid,jsonb),finance_private.read_employee_advance_payment_history(uuid,uuid,jsonb),public.get_finance_employee_advance_payment_history(uuid,uuid,jsonb),finance_private.preview_employee_advance_action(uuid,uuid,text),public.preview_finance_employee_advance_action(uuid,uuid,text),finance_private.dispatch_employee_advance_action(jsonb),public.apply_finance_employee_advance_action(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.dispatch_employee_advance_registration(jsonb),public.record_finance_employee_advance(jsonb),finance_private.preview_employee_advance_payment(uuid,uuid,uuid,text),public.preview_finance_employee_advance_payment(uuid,uuid,uuid,text),finance_private.dispatch_employee_advance_payment(jsonb),public.record_finance_employee_advance_payment(jsonb),finance_private.read_employee_advance_payment_options(uuid,uuid,jsonb),public.get_finance_employee_advance_payment_options(uuid,uuid,jsonb),finance_private.read_employee_advance_payment_history(uuid,uuid,jsonb),public.get_finance_employee_advance_payment_history(uuid,uuid,jsonb),finance_private.preview_employee_advance_action(uuid,uuid,text),public.preview_finance_employee_advance_action(uuid,uuid,text),finance_private.dispatch_employee_advance_action(jsonb),public.apply_finance_employee_advance_action(jsonb) to authenticated;
