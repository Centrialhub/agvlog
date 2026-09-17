-- Candidate: record only demonstrated employee advance payments in draft payroll.
set local lock_timeout='3s';
set local statement_timeout='30s';

do $preflight$declare s record;p record;begin
 for s in select * from(values
 ('public.generate_payroll_period(uuid,date,date,text,boolean,boolean)','911c1bdd64360329da539b73eaf4188e'),
 ('public.recompute_payroll_entry_totals(uuid)','033447727a083fac66d14e54f911ba94'),
 ('public.approve_payroll_period(uuid)','3d73700053d31d676fd1498d48d66d48'),
 ('finance_private.paid_projection_chain(uuid,text,uuid)','3f8f086b42fbbda71ee22f02ee46bc58')
 ) x(signature,hash) loop
 select * into p from pg_proc where oid=to_regprocedure(s.signature);
 if not found or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from s.hash or not p.prosecdef or p.provolatile is distinct from (case when s.signature like 'finance_private.%' then 's' else 'v' end)::char or p.proconfig is distinct from (case when s.signature like 'finance_private.%' then array['search_path=""'] else array['search_path=public'] end)::text[] or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') is distinct from (s.signature in('public.generate_payroll_period(uuid,date,date,text,boolean,boolean)','public.approve_payroll_period(uuid)')) or has_function_privilege('service_role',p.oid,'execute') is distinct from (s.signature like 'public.%') or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where acl.grantee not in(p.proowner,(select oid from pg_roles where rolname='authenticated'),(select oid from pg_roles where rolname='service_role'))) then raise exception 'finance_payroll_advance_predecessor_changed: %',s.signature;end if;
 end loop;
 if to_regprocedure('finance_private.employee_advance_position(uuid,uuid)') is null then raise exception 'finance_payroll_advance_position_required';end if;
end;$preflight$;

create function finance_private.payroll_advance_payment_evidence(t uuid,advance uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare pos jsonb;fp jsonb;begin
 pos:=finance_private.employee_advance_position(t,advance);
 if pos->'verified' is distinct from 'true'::jsonb then raise exception 'finance_payroll_advance_source_review' using errcode='23514';end if;
 select coalesce(jsonb_agg(value order by value->>'payment_id',value->>'link_id'),'[]') into fp from jsonb_array_elements(pos->'footprints');
 return jsonb_build_object('version',1,'advance_id',advance,'employee_id',pos->'employee_id','driver_id',pos->'driver_id','payable_id',pos->'payable_id','amount_cents',pos->'amount_cents','paid_cents',pos->'paid_cents','footprints',fp);
end$$;
revoke all on function finance_private.payroll_advance_payment_evidence(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.refresh_payroll_employee_advances(t uuid,entry uuid) returns void
language plpgsql security definer set search_path='' as $$
declare e public.payroll_entries%rowtype;p public.payroll_periods%rowtype;a public.employee_advances%rowtype;proof jsonb;item public.payroll_entry_items%rowtype;begin
 perform finance_private.require_access(t);
 select * into e from public.payroll_entries where tenant_id=t and id=entry for update;
 select * into p from public.payroll_periods where tenant_id=t and id=e.payroll_period_id for update;
 if e.id is null or e.status not in('draft','calculated') or p.status not in('draft','calculated') then raise exception 'finance_payroll_period_protected' using errcode='55000';end if;
 if exists(select 1 from public.payroll_entry_items where tenant_id=t and payroll_entry_id=entry and source_table='employee_advances' and (locked or item_type<>'driver_advance' or nature<>'already_paid')) then raise exception 'finance_payroll_advance_item_review' using errcode='23514';end if;
 delete from public.payroll_entry_items x where x.tenant_id=t and x.payroll_entry_id=entry and x.source_table='employee_advances' and not exists(select 1 from public.employee_advances source_row where source_row.tenant_id=t and source_row.id=x.source_id and source_row.employee_id=e.employee_id and source_row.advance_date between p.period_start and p.period_end);
 for a in select * from public.employee_advances where tenant_id=t and employee_id=e.employee_id and advance_date between p.period_start and p.period_end order by id for share nowait loop
  proof:=finance_private.payroll_advance_payment_evidence(t,a.id);
  if exists(select 1 from public.payroll_entry_items other join public.payroll_entries oe on oe.tenant_id=t and oe.id=other.payroll_entry_id join public.payroll_periods op on op.tenant_id=t and op.id=oe.payroll_period_id where other.tenant_id=t and other.source_table='employee_advances' and other.source_id=a.id and other.payroll_entry_id<>entry and oe.status<>'cancelled' and op.status<>'cancelled') then raise exception 'finance_payroll_advance_already_claimed' using errcode='23514';end if;
  if (proof->>'paid_cents')::numeric=0 then delete from public.payroll_entry_items where tenant_id=t and payroll_entry_id=entry and source_table='employee_advances' and source_id=a.id;continue;end if;
  if (select count(*) from public.payroll_entry_items where tenant_id=t and payroll_entry_id=entry and source_table='employee_advances' and source_id=a.id)>1 then raise exception 'finance_payroll_advance_item_review' using errcode='23514';end if;
  select * into item from public.payroll_entry_items where tenant_id=t and payroll_entry_id=entry and source_table='employee_advances' and source_id=a.id;
  if item.id is null then
   insert into public.payroll_entry_items(tenant_id,payroll_period_id,payroll_entry_id,employee_id,driver_id,item_type,nature,description,amount,source_table,source_id,competence_date,created_by,source_metadata)
   values(t,p.id,e.id,e.employee_id,e.driver_id,'driver_advance','already_paid','Adiantamento efetivamente entregue',(proof->>'paid_cents')::numeric/100,'employee_advances',a.id,a.advance_date,auth.uid(),jsonb_build_object('employee_advance_payment',proof));
  elsif item.amount is distinct from (proof->>'paid_cents')::numeric/100 or item.source_metadata->'employee_advance_payment' is distinct from proof then
   update public.payroll_entry_items set amount=(proof->>'paid_cents')::numeric/100,source_metadata=coalesce(source_metadata,'{}')||jsonb_build_object('employee_advance_payment',proof) where id=item.id;
  end if;
 end loop;
end$$;
revoke all on function finance_private.refresh_payroll_employee_advances(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.assert_payroll_employee_advances(t uuid,period uuid) returns void
language plpgsql stable security definer set search_path='' as $$
declare item record;proof jsonb;source record;begin
 for source in select a.id,e.id entry_id from public.employee_advances a join public.payroll_entries e on e.tenant_id=t and e.employee_id=a.employee_id join public.payroll_periods p on p.tenant_id=t and p.id=e.payroll_period_id where a.tenant_id=t and p.id=period and e.status<>'cancelled' and a.advance_date between p.period_start and p.period_end loop
  proof:=finance_private.payroll_advance_payment_evidence(t,source.id);
  if (proof->>'paid_cents')::numeric>0 and not exists(select 1 from public.payroll_entry_items x where x.tenant_id=t and x.payroll_entry_id=source.entry_id and x.source_table='employee_advances' and x.source_id=source.id and x.source_metadata->'employee_advance_payment'=proof) then raise exception 'finance_payroll_advance_changed_recalculate' using errcode='40001';end if;
 end loop;
 for item in select x.*,e.employee_id expected_employee from public.payroll_entry_items x join public.payroll_entries e on e.tenant_id=t and e.id=x.payroll_entry_id where x.tenant_id=t and x.payroll_period_id=period and x.source_table='employee_advances' and e.status<>'cancelled' loop
  proof:=finance_private.payroll_advance_payment_evidence(t,item.source_id);
  if item.nature<>'already_paid' or item.item_type<>'driver_advance' or item.amount is distinct from (proof->>'paid_cents')::numeric/100 or item.source_metadata->'employee_advance_payment' is distinct from proof or item.expected_employee::text is distinct from proof->>'employee_id' then raise exception 'finance_payroll_advance_changed_recalculate' using errcode='40001';end if;
 end loop;
end$$;
revoke all on function finance_private.assert_payroll_employee_advances(uuid,uuid) from public,anon,authenticated,service_role;
do $patch$declare d text;a text;b text;begin
 select pg_get_functiondef('public.generate_payroll_period(uuid,date,date,text,boolean,boolean)'::regprocedure) into d;d:=replace(d,E'\r\n',E'\n');
 a:='    -- 2) Advances paid within period';b:='    -- 3) Incident payroll discounts';
 if position(a in d)=0 or position(b in d)<=position(a in d) then raise exception 'finance_payroll_advance_generator_anchor_changed';end if;
 d:=overlay(d placing E'    -- Actual advance composition is refreshed by recomputation below.\n\n' from position(a in d) for position(b in d)-position(a in d));execute d;
 select pg_get_functiondef('public.recompute_payroll_entry_totals(uuid)'::regprocedure) into d;d:=replace(d,E'\r\n',E'\n');
 a:='  SELECT COALESCE(SUM(amount) FILTER (WHERE nature=''credit''),0),';
 if position(a in d)=0 then raise exception 'finance_payroll_advance_recompute_anchor_changed';end if;
 execute replace(d,a,'  PERFORM finance_private.refresh_payroll_employee_advances((select tenant_id from public.payroll_entries where id=_entry_id),_entry_id);'||E'\n'||a);
 select pg_get_functiondef('public.approve_payroll_period(uuid)'::regprocedure) into d;d:=replace(d,E'\r\n',E'\n');
 a:='  INSERT INTO public.payroll_generation_issues(';
 if position(a in d)=0 then raise exception 'finance_payroll_advance_approval_anchor_changed';end if;
 execute replace(d,a,'  PERFORM finance_private.assert_payroll_employee_advances(_tenant,_period_id);'||E'\n'||a);
end;$patch$;

create function finance_private.assert_employee_payroll_window_unmaterialized(t uuid,employee uuid,effective_on date) returns void
language plpgsql stable security definer set search_path='' as $$begin
 if exists(select 1 from public.payroll_entries e join public.payroll_periods p on p.tenant_id=t and p.id=e.payroll_period_id
 where e.tenant_id=t and e.employee_id=employee and effective_on between p.period_start and p.period_end
 and (e.status in('approved','closed') or p.status in('approved','closed') or exists(select 1 from public.payables q join finance_private.active_payable_payments paid on paid.tenant_id=t and paid.payable_id=q.id where q.tenant_id=t and q.source_table='payroll_entries' and q.source_id=e.id))) then
  raise exception 'finance_advance_materialized_in_payroll' using errcode='55000';end if;
end$$;
revoke all on function finance_private.assert_employee_payroll_window_unmaterialized(uuid,uuid,date) from public,anon,authenticated,service_role;

create function finance_private.assert_advance_payroll_unmaterialized(t uuid,advance uuid) returns void
language plpgsql stable security definer set search_path='' as $$
declare employee uuid;effective_on date;begin
 if exists(select 1 from public.payroll_entry_items x join public.payroll_entries e on e.tenant_id=t and e.id=x.payroll_entry_id join public.payroll_periods p on p.tenant_id=t and p.id=e.payroll_period_id
 where x.tenant_id=t and x.source_table='employee_advances' and x.source_id=advance and (x.locked or e.status in('approved','closed') or p.status in('approved','closed') or exists(select 1 from public.payables q join finance_private.active_payable_payments paid on paid.tenant_id=t and paid.payable_id=q.id where q.tenant_id=t and q.source_table='payroll_entries' and q.source_id=e.id))) then
  raise exception 'finance_advance_materialized_in_payroll' using errcode='55000';end if;
 select a.employee_id,a.advance_date into employee,effective_on from public.employee_advances a where a.tenant_id=t and a.id=advance;
 if employee is not null then perform finance_private.assert_employee_payroll_window_unmaterialized(t,employee,effective_on);end if;
end$$;
revoke all on function finance_private.assert_advance_payroll_unmaterialized(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.guard_employee_advance_payroll_source() returns trigger
language plpgsql security definer set search_path='' as $$
declare v jsonb;t uuid;title uuid;movement uuid;a uuid;link uuid;begin
 for v in select value from jsonb_array_elements(case when tg_op='INSERT' then jsonb_build_array(to_jsonb(new)) when tg_op='DELETE' then jsonb_build_array(to_jsonb(old)) else jsonb_build_array(to_jsonb(old),to_jsonb(new)) end) loop
  t:=(v->>'tenant_id')::uuid;title:=null;movement:=null;
  if not pg_try_advisory_xact_lock(hashtextextended(t::text||':finance',0)) then raise exception 'finance_dependency_busy' using errcode='40001';end if;
  if tg_table_name='employee_advances' then
   if tg_op='UPDATE' and (to_jsonb(old)-array['updated_at','paid_at','paid_by']) is not distinct from (to_jsonb(new)-array['updated_at','paid_at','paid_by']) then continue;end if;
   perform finance_private.assert_advance_payroll_unmaterialized(t,(v->>'id')::uuid);continue;
  elsif tg_table_name='payables_payments' then title:=(v->>'payable_id')::uuid;
  elsif tg_table_name='finance_payable_link_reversals' then select payable_id into title from public.finance_payable_movement_links where tenant_id=t and id=(v->>'link_id')::uuid;
  elsif tg_table_name='payables' then title:=(v->>'id')::uuid;
  elsif tg_table_name='finance_movements' then movement:=(v->>'id')::uuid;
  elsif tg_table_name='finance_movement_voids' then movement:=(v->>'movement_id')::uuid;
  elsif tg_table_name='bank_transactions' then null;
  end if;
  for a in select ad.id from public.employee_advances ad where ad.tenant_id=t and (ad.payable_id=title or exists(select 1 from public.finance_payable_movement_links l where l.tenant_id=t and l.payable_id=ad.payable_id and l.movement_id=movement) or (tg_table_name='bank_transactions' and exists(select 1 from public.payables_payments pp where pp.tenant_id=t and pp.payable_id=ad.payable_id and pp.bank_transaction_id=(v->>'id')::uuid))) loop
   perform finance_private.assert_advance_payroll_unmaterialized(t,a);
  end loop;
 end loop;return case when tg_op='DELETE' then old else new end;
end$$;
revoke all on function finance_private.guard_employee_advance_payroll_source() from public,anon,authenticated,service_role;
-- Guard source changes without modifying legacy writer bodies. Existing period guards remain active.
create trigger finance_advance_payroll_payment before insert or update or delete on public.payables_payments for each row execute function finance_private.guard_employee_advance_payroll_source();
create trigger finance_advance_payroll_reversal before insert on public.finance_payable_link_reversals for each row execute function finance_private.guard_employee_advance_payroll_source();
create trigger finance_advance_payroll_advance before update or delete on public.employee_advances for each row execute function finance_private.guard_employee_advance_payroll_source();
create trigger finance_advance_payroll_title before update or delete on public.payables for each row execute function finance_private.guard_employee_advance_payroll_source();
create trigger finance_advance_payroll_movement before update or delete on public.finance_movements for each row execute function finance_private.guard_employee_advance_payroll_source();
create trigger finance_advance_payroll_void before insert on public.finance_movement_voids for each row execute function finance_private.guard_employee_advance_payroll_source();
create trigger finance_advance_payroll_bank before update or delete on public.bank_transactions for each row execute function finance_private.guard_employee_advance_payroll_source();
create function finance_private.payroll_advance_source_chain(t uuid,advance uuid,metadata jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare proof jsonb;snapshot jsonb;valid boolean;issue text;begin
 if metadata->'employee_advance_payment' is null then return finance_private.paid_projection_chain(t,'employee_advances',advance);end if;
 begin proof:=finance_private.payroll_advance_payment_evidence(t,advance);exception when sqlstate '23514' or sqlstate '22023' then return jsonb_build_object('valid',false,'issue','paid_projection_advance_unverified','footprints','[]'::jsonb,'snapshot',metadata);end;
 valid:=proof=metadata->'employee_advance_payment';if not valid then issue:='paid_projection_advance_changed';end if;
 return jsonb_build_object('valid',valid,'issue',issue,'footprints',proof->'footprints','snapshot',jsonb_build_object('stored',metadata->'employee_advance_payment','current',proof));
end$$;
revoke all on function finance_private.payroll_advance_source_chain(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

do $chain$declare d text;a text;b text;begin
 select pg_get_functiondef('finance_private.paid_projection_chain(uuid,text,uuid)'::regprocedure) into d;d:=replace(d,E'\r\n',E'\n');
 a:='parent:=finance_private.paid_projection_chain(_tenant,''employee_advances'',pi.source_id);';
 if position(a in d)=0 then raise exception 'finance_payroll_advance_chain_anchor_changed';end if;
 d:=replace(d,a,'parent:=finance_private.payroll_advance_source_chain(_tenant,pi.source_id,pi.source_metadata);');
 a:='or pi.amount is distinct from a.amount then';
 if position(a in d)=0 then raise exception 'finance_payroll_advance_amount_anchor_changed';end if;
 d:=replace(d,a,'or pi.amount is distinct from (case when pi.source_metadata ? ''employee_advance_payment'' then (pi.source_metadata#>>''{employee_advance_payment,paid_cents}'')::numeric/100 else a.amount end) then');execute d;
end;$chain$;

create function finance_private.guard_payroll_advance_materialization() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if new.status in('approved','closed') and old.status is distinct from new.status then
  if not pg_try_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0)) then raise exception 'finance_dependency_busy' using errcode='40001';end if;
  perform finance_private.assert_payroll_employee_advances(new.tenant_id,case when tg_table_name='payroll_periods' then new.id else (to_jsonb(new)->>'payroll_period_id')::uuid end);
 end if;return new;
end$$;
revoke all on function finance_private.guard_payroll_advance_materialization() from public,anon,authenticated,service_role;
create trigger finance_payroll_advance_period before update of status on public.payroll_periods for each row execute function finance_private.guard_payroll_advance_materialization();
create trigger finance_payroll_advance_entry before update of status on public.payroll_entries for each row execute function finance_private.guard_payroll_advance_materialization();
