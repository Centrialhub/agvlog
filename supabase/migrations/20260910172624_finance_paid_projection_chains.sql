create function finance_private.paid_projection_chain(_tenant uuid,_table text,_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.employee_advances%rowtype;p public.payables%rowtype;e public.employees%rowtype;pi public.payroll_entry_items%rowtype;pe public.payroll_entries%rowtype;period public.payroll_periods%rowtype;
 leg record;m public.finance_movements%rowtype;settle public.driver_settlement_payments%rowtype;parent jsonb;fp jsonb:='[]';snap jsonb:='{}';issue text;total numeric:=0;n integer;used numeric;
begin
 if _table='employee_advances' then
 select * into a from public.employee_advances where tenant_id=_tenant and id=_id;
 select * into e from public.employees where tenant_id=_tenant and id=a.employee_id;
 snap:=jsonb_build_object('advance',to_jsonb(a),'employee',to_jsonb(e));
 if a.id is null then issue:='paid_projection_source_missing';
 elsif a.status is distinct from 'paid' then issue:='advance_not_paid';
 elsif e.id is null or a.driver_id is distinct from e.driver_id then issue:='paid_projection_employee_mismatch';
 elsif not coalesce(a.amount>0 and a.amount*100=trunc(a.amount*100) and a.amount*100<=99999999999999,false) then issue:='paid_projection_invalid_amount';end if;
 select count(*) into n from public.payables t where t.tenant_id=_tenant and (t.id=a.payable_id or t.source_table='employee_advances' and t.source_id=a.id or t.source_table='financial_obligations' and t.source_id=a.financial_obligation_id);
 select * into p from public.payables where tenant_id=_tenant and id=a.payable_id;
 if n<>1 or p.id is null or p.source_table is distinct from 'employee_advances' or p.source_id is distinct from a.id or p.amount is distinct from a.amount or p.driver_id is distinct from a.driver_id or p.status='cancelled' then issue:=coalesce(issue,'advance_title_chain_invalid');end if;
 if p.source_metadata ? 'employee_id' and p.source_metadata->>'employee_id' is distinct from a.employee_id::text then issue:=coalesce(issue,'paid_projection_metadata_mismatch');end if;
 if p.source_metadata ? 'driver_id' and p.source_metadata->>'driver_id' is distinct from a.driver_id::text then issue:=coalesce(issue,'paid_projection_metadata_mismatch');end if;
 snap:=snap||jsonb_build_object('titles',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.payables t where tenant_id=_tenant and (t.id=a.payable_id or t.source_table='employee_advances' and t.source_id=a.id or t.source_table='financial_obligations' and t.source_id=a.financial_obligation_id)),
 'payments',(select coalesce(jsonb_agg(to_jsonb(pp) order by pp.id),'[]') from public.payables_payments pp where pp.tenant_id=_tenant and pp.payable_id=p.id),
 'links',(select coalesce(jsonb_agg(jsonb_build_object('link',to_jsonb(l),'reversal',(select to_jsonb(r) from public.finance_payable_link_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id)) order by l.id),'[]') from public.finance_payable_movement_links l where l.tenant_id=_tenant and l.payable_id=p.id));
 for leg in select pp.*, (select count(*) from public.finance_payable_movement_links l where l.tenant_id=_tenant and l.payment_id=pp.id and not exists(select 1 from public.finance_payable_link_reversals r where r.tenant_id=_tenant and r.link_id=l.id)) link_count,
  (select to_jsonb(l) from public.finance_payable_movement_links l where l.tenant_id=_tenant and l.payment_id=pp.id and not exists(select 1 from public.finance_payable_link_reversals r where r.tenant_id=_tenant and r.link_id=l.id) order by l.id limit 1) link
 from finance_private.active_payable_payments pp where pp.tenant_id=_tenant and pp.payable_id=p.id order by pp.id loop
 total:=total+leg.amount;
 select * into m from public.finance_movements where tenant_id=_tenant and id=(leg.link->>'movement_id')::uuid;
 used:=case when m.id is not null then finance_private.movement_used_cents(_tenant,m.id) end;
 if not coalesce(leg.link_count=1 and leg.amount>0 and leg.amount*100=trunc(leg.amount*100) and leg.amount*100<=99999999999999 and (leg.link->>'amount_cents')::numeric=leg.amount*100 and leg.link->>'payable_id'=p.id::text
 and m.id is not null and m.direction='out' and m.nature<>'transfer' and m.driver_id is not distinct from a.driver_id and m.bank_account_id=leg.bank_account_id and isfinite(leg.paid_at) and m.occurred_on=(leg.paid_at at time zone 'America/Sao_Paulo')::date and used>=leg.amount*100 and used<=m.amount_cents and exists(select 1 from public.bank_accounts where tenant_id=_tenant and id=m.bank_account_id),false) then issue:=coalesce(issue,'advance_payment_chain_invalid');end if;
 if m.id is not null then fp:=fp||jsonb_build_array(jsonb_build_object('payment_id',leg.id,'link_id',leg.link->>'id','movement_id',m.id,'account_id',m.bank_account_id,'occurred_on',case when isfinite(m.occurred_on) then m.occurred_on end,'amount_cents',case when leg.amount*100=trunc(leg.amount*100) then trunc(leg.amount*100)::text end));end if;
 end loop;
 if total is distinct from a.amount or jsonb_array_length(fp)=0 then issue:=coalesce(issue,'advance_not_fully_paid');end if;
 elsif _table='payroll_entry_items' then
 select * into pi from public.payroll_entry_items where tenant_id=_tenant and id=_id;
 select * into pe from public.payroll_entries where tenant_id=_tenant and id=pi.payroll_entry_id;
 select * into period from public.payroll_periods where tenant_id=_tenant and id=pi.payroll_period_id;
 select * into e from public.employees where tenant_id=_tenant and id=pi.employee_id;
 snap:=jsonb_build_object('item',to_jsonb(pi),'entry',to_jsonb(pe),'period',to_jsonb(period),'employee',to_jsonb(e));
 if pi.id is null or pi.nature is distinct from 'already_paid' then issue:='paid_projection_source_missing';
 elsif pe.id is null or period.id is null or e.id is null or pe.payroll_period_id<>pi.payroll_period_id or pe.employee_id<>pi.employee_id or pe.driver_id is distinct from e.driver_id or pi.driver_id is distinct from e.driver_id then issue:='paid_projection_parent_mismatch';
 elsif pe.status='cancelled' or period.status='cancelled' then issue:='paid_projection_cancelled_requires_review';end if;
 if (select count(*) from public.payroll_entry_items x where x.tenant_id=_tenant and x.nature='already_paid' and x.employee_id=pi.employee_id and x.source_table=pi.source_table and x.source_id=pi.source_id)<>1 then issue:=coalesce(issue,'paid_projection_duplicate_source');end if;
 if pi.source_table='employee_advances' then
 parent:=finance_private.paid_projection_chain(_tenant,'employee_advances',pi.source_id);
 select * into a from public.employee_advances where tenant_id=_tenant and id=pi.source_id;
 if a.employee_id is distinct from pi.employee_id or a.driver_id is distinct from pi.driver_id or pi.amount is distinct from a.amount then issue:=coalesce(issue,'paid_projection_source_mismatch');end if;
 elsif pi.source_table='driver_settlement_payments' then
 parent:=finance_private.legacy_cut_settlement_evidence(_tenant,pi.source_id);
 select * into settle from public.driver_settlement_payments where tenant_id=_tenant and id=pi.source_id;
 select * into m from public.finance_movements where tenant_id=_tenant and id=(parent->'movement_ids'->>0)::uuid;
 if pi.amount is distinct from settle.amount or m.driver_id is distinct from pi.driver_id or pi.driver_id is null then issue:=coalesce(issue,'paid_projection_source_mismatch');end if;
 parent:=parent||jsonb_build_object('footprints',case when m.id is not null then jsonb_build_array(jsonb_build_object('payment_id',settle.id,'link_id',parent->>'link_id','movement_id',m.id,'account_id',m.bank_account_id,'occurred_on',m.occurred_on,'amount_cents',trunc(settle.amount*100)::text)) else '[]'::jsonb end,'snapshot',jsonb_build_object('payment',to_jsonb(settle),'movement',to_jsonb(m)));
 if pi.source_metadata ? 'movement_id' and pi.source_metadata->>'movement_id' is distinct from m.id::text then issue:=coalesce(issue,'paid_projection_metadata_mismatch');end if;
 if pi.source_metadata ? 'settlement_id' and pi.source_metadata->>'settlement_id' is distinct from settle.settlement_id::text then issue:=coalesce(issue,'paid_projection_metadata_mismatch');end if;
 else issue:=coalesce(issue,'paid_projection_unsupported_source');end if;
 if parent->'valid' is distinct from 'true'::jsonb then issue:=coalesce(issue,'paid_projection_parent_unresolved');end if;
 fp:=coalesce(parent->'footprints','[]');snap:=snap||jsonb_build_object('parent',parent);
 else issue:='paid_projection_unsupported_source';end if;
 snap:=snap||jsonb_build_object('footprints',fp,'movement_evidence',(select coalesce(jsonb_agg(to_jsonb(money_row) order by money_row.id),'[]') from public.finance_movements money_row where money_row.tenant_id=_tenant and exists(select 1 from jsonb_array_elements(fp) f where f->>'movement_id'=money_row.id::text)),
 'capacity_payable_links',(select coalesce(jsonb_agg(jsonb_build_object('link',to_jsonb(link_row),'reversal',(select to_jsonb(rv) from public.finance_payable_link_reversals rv where rv.tenant_id=_tenant and rv.link_id=link_row.id)) order by link_row.id),'[]') from public.finance_payable_movement_links link_row where link_row.tenant_id=_tenant and exists(select 1 from jsonb_array_elements(fp) f where f->>'movement_id'=link_row.movement_id::text)),
 'capacity_settlement_links',(select coalesce(jsonb_agg(jsonb_build_object('link',to_jsonb(link_row),'reversal',(select to_jsonb(rv) from public.finance_settlement_link_reversals rv where rv.tenant_id=_tenant and rv.link_id=link_row.id),'settlement',(select to_jsonb(st) from public.driver_settlements st where st.tenant_id=_tenant and st.id=link_row.settlement_id)) order by link_row.id),'[]') from public.finance_settlement_movement_links link_row where link_row.tenant_id=_tenant and exists(select 1 from jsonb_array_elements(fp) f where f->>'movement_id'=link_row.movement_id::text)),
 'capacity_expenses',(select coalesce(jsonb_agg(to_jsonb(allocation_row) order by allocation_row.id),'[]') from public.finance_expense_allocations allocation_row where allocation_row.tenant_id=_tenant and exists(select 1 from jsonb_array_elements(fp) f where f->>'movement_id'=allocation_row.movement_id::text)),
 'accounts',(select coalesce(jsonb_agg(to_jsonb(account_row) order by account_row.id),'[]') from public.bank_accounts account_row where account_row.tenant_id=_tenant and exists(select 1 from jsonb_array_elements(fp) f where f->>'account_id'=account_row.id::text)),
 'duplicate_items',(select coalesce(jsonb_agg(to_jsonb(other_item) order by other_item.id),'[]') from public.payroll_entry_items other_item where other_item.tenant_id=_tenant and other_item.employee_id=pi.employee_id and other_item.nature='already_paid' and other_item.source_table=pi.source_table and other_item.source_id=pi.source_id));
 return jsonb_build_object('version',1,'valid',issue is null,'issue',issue,'source_table',_table,'source_id',_id,'footprints',fp,'snapshot',snap,'revision',md5(snap::text));
end$$;
revoke all on function finance_private.paid_projection_chain(uuid,text,uuid) from public,anon,authenticated,service_role;
do $$declare body text;needle text;begin
 select pg_get_functiondef('finance_private.legacy_cut_manifest(uuid,uuid,date,date)'::regprocedure) into body;
 needle:='classification text;table_name text;';if position(needle in body)=0 then raise exception 'paid_projection_manifest_contract_changed';end if;
 body:=replace(body,needle,'projection jsonb;footprint jsonb;projection_slice jsonb;classification text;table_name text;');
 needle:='''driver_settlements''] loop';if position(needle in body)=0 then raise exception 'paid_projection_evidence_contract_changed';end if;
 body:=replace(body,needle,'''driver_settlements'',''employees'',''payables'',''payroll_entries'',''payroll_periods'',''financial_obligations''] loop');
 needle:='   day:=case table_name';if position(needle in body)=0 then raise exception 'paid_projection_slice_contract_changed';end if;
 body:=replace(body,needle,$patch$   if table_name in('employee_advances','payroll_entry_items') then
    projection:=finance_private.paid_projection_chain(_tenant,table_name,(item->>'id')::uuid);
    if projection->'valid'='true'::jsonb then
     select coalesce(jsonb_agg(f order by f->>'movement_id',f->>'payment_id'),'[]') into projection_slice from jsonb_array_elements(projection->'footprints') f where f->>'account_id'=_account::text and (f->>'occurred_on')::date between _from and _to;
     if jsonb_array_length(projection_slice)>0 then
      sources:=sources||jsonb_build_array(jsonb_build_object('source_table',table_name,'source_id',item->>'id','occurred_on',null,'account_id',_account,'amount_cents',null,'movement_ids',(select jsonb_agg(distinct f->>'movement_id') from jsonb_array_elements(projection_slice) f),'classification','exact_projection_alias','footprints',projection_slice,'chain_revision',projection->>'revision'));
     end if;
    else
     sources:=sources||jsonb_build_array(jsonb_build_object('source_table',table_name,'source_id',item->>'id','occurred_on',null,'account_id',null,'amount_cents',null,'movement_ids','[]'::jsonb,'classification','requires_resolution','footprints',projection->'footprints','chain_revision',projection->>'revision'));
     blockers:=blockers||jsonb_build_array(jsonb_build_object('code',coalesce(projection->>'issue','paid_projection_unresolved'),'source_table',table_name,'source_id',item->>'id'));
    end if;
    evidence:=evidence||jsonb_build_object('paid_projection_chain:'||table_name||':'||(item->>'id'),jsonb_build_array(projection));
    continue;
   end if;
   day:=case table_name$patch$);
 body:=replace(body,'''classifier_version'',''2''','''classifier_version'',''3''');execute body;
end$$;
-- Resolve the same graph at deferred commit; paid status never grants an exemption.
create function finance_private.guard_late_paid_projection() returns trigger language plpgsql security definer set search_path='' as $$
declare current_row jsonb;chain jsonb;f jsonb;actor_name text;proven boolean:=true;begin
 if not pg_try_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0)) then raise exception 'finance_period_source_busy' using errcode='40001';end if;
 if not finance_private.closed_interval_exists(new.tenant_id,null,null,null) then return new;end if;
 execute format('select to_jsonb(x) from public.%I x where tenant_id=$1 and id=$2',tg_table_name) into current_row using new.tenant_id,new.id;
 if current_row is null then return new;end if;
 if tg_table_name='employee_advances' and current_row->>'status' is distinct from 'paid' then perform finance_private.assert_closed_source_mutable(new.tenant_id,tg_table_name,current_row);return new;end if;
 if tg_table_name='payroll_entry_items' and current_row->>'nature' is distinct from 'already_paid' then return new;end if;
 chain:=finance_private.paid_projection_chain(new.tenant_id,tg_table_name,new.id);
 if chain->'valid' is distinct from 'true'::jsonb or jsonb_array_length(chain->'footprints')=0 then proven:=false;
 else for f in select value from jsonb_array_elements(chain->'footprints') loop
  if finance_private.closed_interval_exists(new.tenant_id,(f->>'account_id')::uuid,(f->>'occurred_on')::date,(f->>'occurred_on')::date) and not finance_private.frozen_movement(new.tenant_id,(f->>'movement_id')::uuid) then proven:=false;end if;
 end loop;end if;
 if proven then
 if not finance_private.can_access(new.tenant_id) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,auth.uid()::text) into actor_name from auth.users where id=auth.uid();
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data) values(new.tenant_id,'late_period_composition',new.id,'closed_period_composition_recorded',auth.uid(),coalesce(actor_name,auth.uid()::text),'Projeção de pagamentos canônicos conferida por cadeia de IDs',chain||jsonb_build_object('cash_changed',false));return new;
 end if;
 perform finance_private.assert_closed_source_mutable(new.tenant_id,tg_table_name,current_row);return new;
end$$;
revoke all on function finance_private.guard_late_paid_projection() from public,anon,authenticated,service_role;
create constraint trigger finance_late_paid_projection after insert or update on public.employee_advances deferrable initially deferred for each row execute function finance_private.guard_late_paid_projection();
create constraint trigger finance_late_paid_projection after insert on public.payroll_entry_items deferrable initially deferred for each row execute function finance_private.guard_late_paid_projection();
do $$declare body text;needle text;begin
 select pg_get_functiondef('finance_private.guard_closed_financial_source()'::regprocedure) into body;
 needle:='if not finance_private.closed_interval_exists(t,null,null,null) then continue;end if;';if position(needle in body)=0 then raise exception 'paid_projection_closed_guard_contract_changed';end if;
 execute replace(body,needle,needle||$patch$
 if tg_op='INSERT' then
  if tg_table_name='employee_advances' then if new.status='paid' then continue;end if;
  elsif tg_table_name='payroll_entry_items' then if new.nature='already_paid' then continue;end if;end if;
 end if;
 if tg_op='UPDATE' and tg_table_name='employee_advances' then
  if old.status is distinct from 'paid' and new.status='paid' and to_jsonb(old)-array['status','paid_by','paid_at','updated_by','updated_at'] is not distinct from to_jsonb(new)-array['status','paid_by','paid_at','updated_by','updated_at'] then continue;end if;
 end if;
 $patch$);
 select pg_get_functiondef('finance_private.account_period_guards_ready()'::regprocedure) into body;
 needle:='select (select count(*)=6';if position(needle in body)=0 then raise exception 'paid_projection_readiness_contract_changed';end if;
 execute replace(body,needle,'select (select count(*)=2 from pg_catalog.pg_trigger tr join pg_catalog.pg_class c on c.oid=tr.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname=''public'' and c.relname in(''employee_advances'',''payroll_entry_items'') and tr.tgname=''finance_late_paid_projection'' and tr.tgdeferrable and tr.tginitdeferred and tr.tgenabled in(''O'',''A'') and tr.tgfoid=''finance_private.guard_late_paid_projection()''::regprocedure) and (select count(*)=6');
end$$;
