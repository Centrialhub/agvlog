-- Forward-only resume: never restores the unsafe legacy APIs.
-- Run as the database administrator, after confirming the exact release.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';
do $release$ declare c record;v_writer boolean;begin
 if not pg_try_advisory_xact_lock(hashtext('settlement-adjustment-release'),1) then raise exception 'settlement_adjustment_release_active_requests';end if;
 v_writer:=has_function_privilege('authenticated','public.apply_driver_settlement_adjustment(jsonb)','execute');
 for c in select * from(values ('public._build_driver_settlement(uuid, uuid)','0732d29f716ed074b9b215aff7569d03',false,false,false),
('public._build_manual_driver_settlement(uuid)','2281ee623376f032433e7761b20c4ca3',false,false,false),
('public._delivery_allocation_document(uuid)','344801e75094a3f40f58e8fdbf7e97cc',false,false,false),
('public._delivery_trip_financial_documents(uuid, uuid)','02296239569087e967b277309579dc8a',false,false,false),
('public._log_settlement_event(uuid, text, text, text, text, jsonb)','66b50396ce538929df80295c80446070',false,false,false),
('public._preserve_closing_creation()','7400244049ef090f7c38dbd0856d78f8',false,false,false),
('public.add_driver_settlement_adjustment(uuid, text, numeric, text, text)','bce03457eeb9512e253b391c21c55b37',false,false,false),
('public.apply_driver_settlement_adjustment(jsonb)','c7b61756bd6244deef16b1105239e091',true,false,false),
('public.get_driver_settlement_adjustment_context(uuid, uuid)','47b8be6a4b0447b10f3abc4756c547a7',true,false,false),
('public.is_tenant_operator_or_admin(uuid)','1345468a366a7b0b9ae62d3ec4825232',true,false,true),
('public.remove_driver_settlement_adjustment(uuid, uuid, text)','81a8a845ee473e44ba1da16819e00b56',false,false,false),
('settlement_adjustment_private.apply(jsonb)','a659f5cc8fa6d0221dac0e2948b7dded',true,false,false),
('settlement_adjustment_private.authorize(uuid)','cf5372cfd700dd7da3becf3b8505b52f',false,false,false),
('settlement_adjustment_private.cents(numeric)','14434eb3b80687f9066202c839d5f6f3',false,false,false),
('settlement_adjustment_private.context(uuid, uuid)','2c59bebd4a96b6f76dea70f9555fff56',true,false,false),
('settlement_adjustment_private.lock_sources(uuid, uuid)','d4dd8b002326589ba5cc01f09df813a3',false,false,false),
('settlement_adjustment_private.release_guard()','261fad49130d6bdc13701aacc51a0db9',false,false,false),
('settlement_adjustment_private.snapshot(uuid, uuid)','49cb8285d2580f34414c8cb0cc17a47a',false,false,false)) expected(signature,hash,auth,anon,service) loop
  if md5(replace(pg_get_functiondef(to_regprocedure(c.signature)),E'\r\n',E'\n')) is distinct from c.hash
   or has_function_privilege('anon',c.signature,'execute') is distinct from c.anon
   or has_function_privilege('service_role',c.signature,'execute') is distinct from c.service
   or has_function_privilege('authenticated',c.signature,'execute') is distinct from
    (case when c.signature in('public.apply_driver_settlement_adjustment(jsonb)','settlement_adjustment_private.apply(jsonb)') then v_writer else c.auth end) then
   raise exception 'Settlement adjustment function or grants changed: %',c.signature;end if;
 end loop;
 if (select relrowsecurity from pg_class where oid='public.driver_settlement_adjustments'::regclass) is distinct from true
  or (select md5(string_agg(policyname||'|'||permissive||'|'||roles::text||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,''),E'\n' order by policyname)) from pg_policies where schemaname='public' and tablename='driver_settlement_adjustments') is distinct from '68bf768ad80369b2f74584c1c732adfc'
  -- PostgreSQL 17 stores column NOT NULL in pg_attribute; 18 also adds pg_constraint rows.
  or (select md5(string_agg(conname||'|'||pg_get_constraintdef(oid),E'\n' order by conname)) from pg_constraint where conrelid='public.driver_settlement_adjustments'::regclass and contype<>'n') is distinct from 'c72c9a8e12baf2400cf14cc8274043ba'
  or (select md5(string_agg(a.attname||'|'||format_type(a.atttypid,a.atttypmod)||'|'||a.attnotnull::text||'|'||coalesce(pg_get_expr(d.adbin,d.adrelid),''),E'\n' order by a.attnum)) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.driver_settlement_adjustments'::regclass and a.attnum>0 and not a.attisdropped) is distinct from 'a9ac1a14057f39cadfba41ce3137b210'
  or not exists(select 1 from pg_trigger where tgrelid='public.driver_settlement_adjustments'::regclass and tgname='settlement_adjustment_append_only' and tgenabled='O' and tgfoid='public._preserve_closing_creation()'::regprocedure and tgtype=27)
  or has_table_privilege('authenticated','public.driver_settlement_adjustments','insert,update,delete,truncate')
  or has_table_privilege('service_role','public.driver_settlement_adjustments','insert,update,delete,truncate')
  or has_table_privilege('authenticated','public.driver_settlement_items','insert,update,delete,truncate') then
  raise exception 'Settlement adjustment evidence or write boundary changed';end if;
end;$release$;
grant execute on function public.apply_driver_settlement_adjustment(jsonb),settlement_adjustment_private.apply(jsonb) to authenticated;
commit;
