-- Seven-user isolated seed only. Never execute against production.
begin;
set local statement_timeout='20s';
do $guard$ begin
 if (select count(*) from auth.users)<>7 or (select count(*) from auth.users where email like '%@agvlog-e2e.invalid')<>7 then
  raise exception 'isolated_seed_required';end if;
 if has_function_privilege('anon','public.set_load_note_check(uuid,uuid,uuid,boolean,integer,uuid)','execute')
  or has_table_privilege('authenticated','public.load_note_check_events','insert') then raise exception 'unsafe_check_permissions';end if;
end;$guard$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select set_config('request.headers','{"x-agvlog-tenant-id":"20000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
do $check$
declare t constant uuid:='20000000-0000-4000-8000-000000000001';l constant uuid:='70000000-0000-4000-8000-000000000001';
 d constant uuid:='90000000-0000-4000-8000-000000000001';r uuid:=gen_random_uuid();a jsonb;b jsonb;before_doc jsonb;
begin
 select to_jsonb(f) into before_doc from public.fiscal_documents f where id=d;
 if before_doc is null then raise exception 'seed_document_required';end if;
 if public.get_load_note_checks(t,l)<>'[]'::jsonb then raise exception 'seed_checks_not_empty';end if;
 a:=public.set_load_note_check(t,l,d,true,0,r);b:=public.set_load_note_check(t,l,d,true,0,r);
 if a is distinct from b or a->>'checked'<>'true' or jsonb_array_length(public.get_load_note_checks(t,l))<>1 then raise exception 'check_replay_failed';end if;
 begin
  perform public.set_load_note_check(t,l,d,false,0,gen_random_uuid());raise exception 'stale_check_accepted';
 exception when serialization_failure then null;end;
 b:=public.set_load_note_check(t,l,d,false,1,gen_random_uuid());
 if b->>'checked'<>'false' or b->>'revision'<>'2' then raise exception 'uncheck_failed';end if;
 if before_doc is distinct from (select to_jsonb(f) from public.fiscal_documents f where id=d) then raise exception 'check_changed_fiscal_document';end if;
 begin
  perform public.get_load_note_checks('20000000-0000-4000-8000-000000000002',l);raise exception 'cross_tenant_check_accepted';
 exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
 begin
  perform public.set_load_note_check(t,l,d,true,2,gen_random_uuid());raise exception 'driver_check_accepted';
 exception when insufficient_privilege then null;end;
end;$check$;
rollback;
