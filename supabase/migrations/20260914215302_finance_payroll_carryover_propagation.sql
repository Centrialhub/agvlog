-- Carry only proven prior payments into the immediately following payroll period.
-- This creates no cash, payable payment, bank transaction, expense or fiscal document.
set local lock_timeout='3s';
set local statement_timeout='30s';

do $preflight$declare spec record;p record;begin
 for spec in select * from(values
  ('public.generate_payroll_period(uuid,date,date,text,boolean,boolean)','f3714abd213645ecb10c477950f0dbeb','search_path=public',true,true),
  ('public.recompute_payroll_entry_totals(uuid)','d7483df0105d5839f6ea4d4cec1b8ed5','search_path=public',false,true),
  ('public.approve_payroll_period(uuid)','6c362056ddb1d07441e0660890022281','search_path=public',true,true),
  ('finance_private.paid_projection_chain(uuid,text,uuid)','6866acdc7109f2d71f4a34806c5bdc1f','search_path=""',false,false)
 )s(signature,hash,config,authenticated,service) loop
  select * into p from pg_proc where oid=to_regprocedure(spec.signature);
  if not found or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from spec.hash or not p.prosecdef
   or p.proconfig is distinct from array[spec.config]::text[]
   or has_function_privilege('anon',p.oid,'execute')
   or has_function_privilege('authenticated',p.oid,'execute') is distinct from spec.authenticated
   or has_function_privilege('service_role',p.oid,'execute') is distinct from spec.service
  then raise exception 'finance_payroll_carryover_predecessor_changed:%',spec.signature using errcode='55000';end if;
 end loop;
end;$preflight$;

create function finance_private.payroll_carryover_evidence(t uuid,source_entry uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e public.payroll_entries%rowtype;p public.payroll_periods%rowtype;employee public.employees%rowtype;
 gross numeric:=0;debit numeric:=0;paid numeric:=0;expected numeric:=0;issues text[]:='{}';
 source_item record;proof jsonb;proofs jsonb:='[]';footprints jsonb:='[]';snapshot jsonb;cents text;
begin
 select * into e from public.payroll_entries where tenant_id=t and id=source_entry;
 select * into p from public.payroll_periods where tenant_id=t and id=e.payroll_period_id;
 select * into employee from public.employees where tenant_id=t and id=e.employee_id;
 if e.id is null or p.id is null or employee.id is null then issues:=array_append(issues,'finance_payroll_carryover_source_missing');
 elsif e.status not in('approved','locked') or p.status not in('approved','closed') then issues:=array_append(issues,'finance_payroll_carryover_source_unmaterialized');
 elsif e.driver_id is distinct from employee.driver_id then issues:=array_append(issues,'finance_payroll_carryover_employee_mismatch');end if;
 select coalesce(sum(i.amount) filter(where i.nature='credit'),0),coalesce(sum(i.amount) filter(where i.nature='debit'),0),coalesce(sum(i.amount) filter(where i.nature='already_paid'),0)
 into gross,debit,paid from public.payroll_entry_items i where i.tenant_id=t and i.payroll_entry_id=source_entry;
 expected:=greatest(paid-greatest(gross-debit,0),0);
 if not coalesce(expected>=0 and expected*100=trunc(expected*100) and expected*100<=99999999999999,false) then
  issues:=array_append(issues,'finance_payroll_carryover_amount_invalid');
 else cents:=trunc(expected*100)::text;end if;
 if e.id is not null and (e.gross_amount is distinct from gross or e.discount_amount is distinct from debit or e.already_paid_amount is distinct from paid
  or e.net_amount is distinct from gross-debit or e.amount_to_pay is distinct from greatest(gross-debit-paid,0) or e.carryover_amount is distinct from expected)
 then issues:=array_append(issues,'finance_payroll_carryover_totals_changed');end if;
 for source_item in select i.id from public.payroll_entry_items i where i.tenant_id=t and i.payroll_entry_id=source_entry and i.nature='already_paid' order by i.id loop
  proof:=finance_private.paid_projection_chain(t,'payroll_entry_items',source_item.id);
  proofs:=proofs||jsonb_build_array(jsonb_build_object('item_id',source_item.id,'proof',proof));
  if proof->'valid' is distinct from 'true'::jsonb then issues:=array_append(issues,'finance_payroll_carryover_payment_unverified');end if;
  footprints:=footprints||coalesce(proof->'footprints','[]'::jsonb);
 end loop;
 if expected>0 and jsonb_array_length(footprints)=0 then issues:=array_append(issues,'finance_payroll_carryover_payment_unverified');end if;
 snapshot:=jsonb_build_object('version',1,'tenant_id',t,'source_entry',to_jsonb(e),'source_period',to_jsonb(p),'employee',to_jsonb(employee),
  'gross_cents',case when gross*100=trunc(gross*100) then trunc(gross*100)::text end,
  'discount_cents',case when debit*100=trunc(debit*100) then trunc(debit*100)::text end,
  'paid_cents',case when paid*100=trunc(paid*100) then trunc(paid*100)::text end,
  'amount_cents',cents,'item_proofs',proofs,'footprints',footprints);
 return snapshot||jsonb_build_object('valid',cardinality(issues)=0,'issues',to_jsonb(issues),'revision',md5(snapshot::text));
end$$;
revoke all on function finance_private.payroll_carryover_evidence(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.payroll_carryover_item_chain(t uuid,item_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare carry_item public.payroll_entry_items%rowtype;target public.payroll_entries%rowtype;target_period public.payroll_periods%rowtype;
 source public.payroll_entries%rowtype;source_period public.payroll_periods%rowtype;proof jsonb;issue text;snapshot jsonb;begin
 select * into carry_item from public.payroll_entry_items where tenant_id=t and id=item_id;
 select * into target from public.payroll_entries where tenant_id=t and id=carry_item.payroll_entry_id;
 select * into target_period from public.payroll_periods where tenant_id=t and id=target.payroll_period_id;
 select * into source from public.payroll_entries where tenant_id=t and id=carry_item.source_id;
 select * into source_period from public.payroll_periods where tenant_id=t and id=source.payroll_period_id;
 if source.id is not null then proof:=finance_private.payroll_carryover_evidence(t,source.id);end if;
 if carry_item.id is null or carry_item.item_type<>'other' or carry_item.nature<>'already_paid' or carry_item.source_table<>'payroll_entries' or not(carry_item.source_metadata ? 'payroll_carryover') then issue:='paid_projection_carryover_source_missing';
 elsif target.id is null or target_period.id is null or source.id is null or source_period.id is null then issue:='paid_projection_carryover_parent_missing';
 elsif target.employee_id is distinct from source.employee_id or carry_item.employee_id is distinct from target.employee_id or target.driver_id is distinct from source.driver_id or carry_item.driver_id is distinct from target.driver_id then issue:='paid_projection_carryover_employee_mismatch';
 elsif source_period.period_end+1 is distinct from target_period.period_start then issue:='paid_projection_carryover_period_mismatch';
 elsif proof->'valid' is distinct from 'true'::jsonb or coalesce((proof->>'amount_cents')::bigint,0)<=0 then issue:='paid_projection_carryover_parent_unresolved';
 elsif carry_item.amount is distinct from (proof->>'amount_cents')::numeric/100 or carry_item.source_metadata->'payroll_carryover' is distinct from proof then issue:='paid_projection_carryover_snapshot_changed';end if;
 snapshot:=jsonb_build_object('item',to_jsonb(carry_item),'target_entry',to_jsonb(target),'target_period',to_jsonb(target_period),'source_entry',to_jsonb(source),'source_period',to_jsonb(source_period),'stored',carry_item.source_metadata->'payroll_carryover','current',proof);
 return jsonb_build_object('valid',issue is null,'issue',issue,'footprints',coalesce(proof->'footprints','[]'::jsonb),'snapshot',snapshot,'revision',md5(snapshot::text));
end$$;
revoke all on function finance_private.payroll_carryover_item_chain(uuid,uuid) from public,anon,authenticated,service_role;

do $chain$declare d text;anchor text;begin
 select pg_get_functiondef('finance_private.paid_projection_chain(uuid,text,uuid)'::regprocedure) into d;d:=replace(d,E'\r\n',E'\n');
 anchor:='elsif pi.source_table=''driver_settlement_payments'' then';
 if position(anchor in d)=0 then raise exception 'finance_payroll_carryover_chain_anchor_changed';end if;
 execute replace(d,anchor,'elsif pi.source_table=''payroll_entries'' and pi.source_metadata ? ''payroll_carryover'' then'||E'\n'||
  'parent:=finance_private.payroll_carryover_item_chain(_tenant,pi.id);'||E'\n'||anchor);
end;$chain$;

create function finance_private.payroll_carryover_context(t uuid,target_entry uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare target public.payroll_entries%rowtype;target_period public.payroll_periods%rowtype;source public.payroll_entries%rowtype;n integer;proof jsonb;begin
 select * into target from public.payroll_entries where tenant_id=t and id=target_entry;
 select * into target_period from public.payroll_periods where tenant_id=t and id=target.payroll_period_id;
 if target.id is null or target_period.id is null then raise exception 'finance_payroll_entry_not_found' using errcode='22023';end if;
 select count(*) into n from public.payroll_entries e join public.payroll_periods p on p.tenant_id=t and p.id=e.payroll_period_id
 where e.tenant_id=t and e.employee_id=target.employee_id and e.status in('approved','locked') and p.status in('approved','closed') and p.period_end+1=target_period.period_start;
 if n>1 then raise exception 'finance_payroll_carryover_source_ambiguous' using errcode='23514';end if;
 select e.* into source from public.payroll_entries e join public.payroll_periods p on p.tenant_id=t and p.id=e.payroll_period_id
 where e.tenant_id=t and e.employee_id=target.employee_id and e.status in('approved','locked') and p.status in('approved','closed') and p.period_end+1=target_period.period_start order by e.id limit 1;
 if source.id is null then return jsonb_build_object('version',1,'tenant_id',t,'target_entry_id',target.id,'employee_id',target.employee_id,'required',false,'source_entry_id',null,'proof',null);end if;
 proof:=finance_private.payroll_carryover_evidence(t,source.id);
 if proof->'valid' is distinct from 'true'::jsonb then raise exception 'finance_payroll_carryover_source_review' using errcode='23514';end if;
 return jsonb_build_object('version',1,'tenant_id',t,'target_entry_id',target.id,'employee_id',target.employee_id,'required',(proof->>'amount_cents')::bigint>0,'source_entry_id',source.id,'proof',proof);
end$$;
revoke all on function finance_private.payroll_carryover_context(uuid,uuid) from public,anon,authenticated,service_role;

create unique index payroll_carryover_target_once on public.payroll_entry_items(tenant_id,payroll_entry_id)
where source_table='payroll_entries' and nature='already_paid' and item_type='other' and source_metadata ? 'payroll_carryover';
create unique index payroll_carryover_source_once on public.payroll_entry_items(tenant_id,source_id)
where source_table='payroll_entries' and nature='already_paid' and item_type='other' and source_metadata ? 'payroll_carryover';

create function finance_private.refresh_payroll_carryover(t uuid,target_entry_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare target public.payroll_entries%rowtype;p public.payroll_periods%rowtype;ctx jsonb;proof jsonb;before_item jsonb;after_item jsonb;n integer;actor_name text;begin
 perform finance_private.require_access(t);
 select * into target from public.payroll_entries where tenant_id=t and id=target_entry_id for update;
 select * into p from public.payroll_periods where tenant_id=t and id=target.payroll_period_id for update;
 if target.id is null or p.id is null then raise exception 'finance_payroll_entry_not_found' using errcode='22023';end if;
 if target.status not in('draft','calculated') or p.status not in('draft','calculated') then raise exception 'finance_payroll_period_protected' using errcode='55000';end if;
 select count(*) into n from public.payroll_entry_items i where i.tenant_id=t and i.payroll_entry_id=target.id and i.source_table='payroll_entries' and i.nature='already_paid' and i.item_type='other' and i.source_metadata ? 'payroll_carryover';
 if n>1 then raise exception 'finance_payroll_carryover_item_ambiguous' using errcode='23514';end if;
 select to_jsonb(i) into before_item from public.payroll_entry_items i where i.tenant_id=t and i.payroll_entry_id=target.id and i.source_table='payroll_entries' and i.nature='already_paid' and i.item_type='other' and i.source_metadata ? 'payroll_carryover' order by i.id limit 1;
 ctx:=finance_private.payroll_carryover_context(t,target.id);proof:=ctx->'proof';
 if ctx->'required' is distinct from 'true'::jsonb then
  delete from public.payroll_entry_items i where i.tenant_id=t and i.payroll_entry_id=target.id and i.source_table='payroll_entries' and i.nature='already_paid' and i.item_type='other' and i.source_metadata ? 'payroll_carryover';
  update public.payroll_entries set source_summary=(case when jsonb_typeof(source_summary)='object' then source_summary else '{}'::jsonb end)-'payroll_carryover' where tenant_id=t and id=target.id;
  if before_item is null then return;end if;
 else
  if before_item is null then
   insert into public.payroll_entry_items(tenant_id,payroll_period_id,payroll_entry_id,employee_id,driver_id,item_type,nature,description,amount,source_table,source_id,source_metadata,competence_date,created_by)
   values(t,p.id,target.id,target.employee_id,target.driver_id,'other','already_paid','Saldo de adiantamento transportado da competência anterior',(proof->>'amount_cents')::numeric/100,'payroll_entries',(ctx->>'source_entry_id')::uuid,jsonb_build_object('payroll_carryover',proof),p.period_start,auth.uid());
  else
   update public.payroll_entry_items set employee_id=target.employee_id,driver_id=target.driver_id,description='Saldo de adiantamento transportado da competência anterior',
    amount=(proof->>'amount_cents')::numeric/100,source_id=(ctx->>'source_entry_id')::uuid,source_metadata=jsonb_build_object('payroll_carryover',proof),competence_date=p.period_start
   where tenant_id=t and payroll_entry_id=target.id and source_table='payroll_entries' and nature='already_paid' and item_type='other' and source_metadata ? 'payroll_carryover';
  end if;
  update public.payroll_entries set source_summary=(case when jsonb_typeof(source_summary)='object' then source_summary else '{}'::jsonb end)||jsonb_build_object('payroll_carryover',proof) where tenant_id=t and id=target.id;
 end if;
 select to_jsonb(i) into after_item from public.payroll_entry_items i where i.tenant_id=t and i.payroll_entry_id=target.id and i.source_table='payroll_entries' and i.nature='already_paid' and i.item_type='other' and i.source_metadata ? 'payroll_carryover';
 if before_item is not distinct from after_item then return;end if;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,auth.uid()::text) into actor_name from auth.users where id=auth.uid();
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(t,'payroll_entry',target.id,case when after_item is null then 'payroll_carryover_removed' else 'payroll_carryover_propagated' end,auth.uid(),coalesce(actor_name,auth.uid()::text),
  'Saldo de adiantamento transportado sem criar novo pagamento.',before_item,jsonb_build_object('item',after_item,'context',ctx,'cash_changed',false,'fiscal_document_created',false));
end$$;
revoke all on function finance_private.refresh_payroll_carryover(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.assert_payroll_carryovers(t uuid,period_id uuid) returns void
language plpgsql stable security definer set search_path='' as $$
declare target public.payroll_entries%rowtype;ctx jsonb;proof jsonb;carry_item public.payroll_entry_items%rowtype;n integer;begin
 for target in select * from public.payroll_entries where tenant_id=t and payroll_period_id=period_id and status<>'cancelled' order by id loop
  ctx:=finance_private.payroll_carryover_context(t,target.id);proof:=ctx->'proof';
  select count(*) into n from public.payroll_entry_items x where x.tenant_id=t and x.payroll_entry_id=target.id and x.source_table='payroll_entries' and x.nature='already_paid' and x.item_type='other' and x.source_metadata ? 'payroll_carryover';
  select * into carry_item from public.payroll_entry_items x where x.tenant_id=t and x.payroll_entry_id=target.id and x.source_table='payroll_entries' and x.nature='already_paid' and x.item_type='other' and x.source_metadata ? 'payroll_carryover' order by x.id limit 1;
  if ctx->'required'='true'::jsonb then
   if n<>1 or carry_item.payroll_period_id is distinct from period_id or carry_item.employee_id is distinct from target.employee_id or carry_item.driver_id is distinct from target.driver_id
    or carry_item.source_id is distinct from (ctx->>'source_entry_id')::uuid or carry_item.amount is distinct from (proof->>'amount_cents')::numeric/100
    or carry_item.source_metadata->'payroll_carryover' is distinct from proof or target.source_summary->'payroll_carryover' is distinct from proof
   then raise exception 'finance_payroll_carryover_changed_recalculate' using errcode='40001';end if;
  elsif n<>0 or target.source_summary ? 'payroll_carryover' then raise exception 'finance_payroll_carryover_changed_recalculate' using errcode='40001';end if;
 end loop;
 if exists(select 1 from public.payroll_entry_items i left join public.payroll_entries e on e.tenant_id=t and e.id=i.payroll_entry_id where i.tenant_id=t and i.payroll_period_id=period_id and i.source_table='payroll_entries' and i.nature='already_paid' and i.item_type='other' and i.source_metadata ? 'payroll_carryover' and (e.id is null or e.status='cancelled'))
 then raise exception 'finance_payroll_carryover_changed_recalculate' using errcode='40001';end if;
end$$;
revoke all on function finance_private.assert_payroll_carryovers(uuid,uuid) from public,anon,authenticated,service_role;

do $patch$declare d text;anchor text;begin
 select pg_get_functiondef('public.generate_payroll_period(uuid,date,date,text,boolean,boolean)'::regprocedure) into d;d:=replace(d,E'\r\n',E'\n');
 anchor:='AND item_type NOT IN (''manual_credit'',''manual_debit'');';
 if position(anchor in d)=0 then raise exception 'finance_payroll_carryover_generation_anchor_changed';end if;
 execute replace(d,anchor,'AND item_type NOT IN (''manual_credit'',''manual_debit'')'||E'\n'||
  '       AND NOT (source_table=''payroll_entries'' AND nature=''already_paid'' AND item_type=''other'' AND source_metadata ? ''payroll_carryover'');');

 select pg_get_functiondef('public.recompute_payroll_entry_totals(uuid)'::regprocedure) into d;d:=replace(d,E'\r\n',E'\n');
 anchor:='  PERFORM finance_private.refresh_payroll_employee_advances((select tenant_id from public.payroll_entries where id=_entry_id),_entry_id);';
 if position(anchor in d)=0 or position('    _carry := _paid - _net;' in d)=0 then raise exception 'finance_payroll_carryover_recompute_anchor_changed';end if;
 d:=replace(d,anchor,anchor||E'\n'||'  PERFORM finance_private.refresh_payroll_carryover((select tenant_id from public.payroll_entries where id=_entry_id),_entry_id);');
 execute replace(d,'    _carry := _paid - _net;','    _carry := _paid - greatest(_net,0);');

 select pg_get_functiondef('public.approve_payroll_period(uuid)'::regprocedure) into d;d:=replace(d,E'\r\n',E'\n');
 anchor:='  PERFORM finance_private.assert_payroll_employee_advances(_tenant,_period_id);';
 if position(anchor in d)=0 then raise exception 'finance_payroll_carryover_approval_anchor_changed';end if;
 execute replace(d,anchor,'  PERFORM finance_private.assert_payroll_carryovers(_tenant,_period_id);'||E'\n'||anchor);
end;$patch$;

create function finance_private.guard_payroll_carryover_materialization() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if new.status in('approved','closed','locked') and old.status is distinct from new.status then
  if not pg_try_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0)) then raise exception 'finance_dependency_busy' using errcode='40001';end if;
  perform finance_private.assert_payroll_carryovers(new.tenant_id,case when tg_table_name='payroll_periods' then new.id else (to_jsonb(new)->>'payroll_period_id')::uuid end);
 end if;return new;
end$$;
revoke all on function finance_private.guard_payroll_carryover_materialization() from public,anon,authenticated,service_role;
create trigger finance_payroll_carryover_period before update of status on public.payroll_periods for each row execute function finance_private.guard_payroll_carryover_materialization();
create trigger finance_payroll_carryover_entry before update of status on public.payroll_entries for each row execute function finance_private.guard_payroll_carryover_materialization();
