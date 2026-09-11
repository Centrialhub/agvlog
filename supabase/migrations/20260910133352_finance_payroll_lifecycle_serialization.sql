-- All browser-facing payroll writers enter before touching period/entry rows.
-- This also protects direct recomputation, which previously updated approved totals.
create function finance_private.lock_payroll_lifecycle(_tenant uuid,_period uuid,_entry uuid,_mode text) returns void
language plpgsql security definer set search_path='' as $$declare p public.payroll_periods%rowtype;e public.payroll_entries%rowtype;begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(_tenant::text||':finance',0));
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 perform id from public.payroll_periods where tenant_id=_tenant and (_period is null or id=_period) order by id for update;
 -- Generation already owns finance and the period set before its INSERTs.
 -- Recomputing one entry must not repeatedly lock every historical payroll.
 perform id from public.payroll_entries where tenant_id=_tenant and payroll_period_id=_period and (_entry is null or id=_entry) order by id for update;
 if _mode='generate' then return;end if;
 select * into p from public.payroll_periods where id=_period and tenant_id=_tenant;
 if not found then raise exception 'finance_payroll_period_not_found' using errcode='22023';end if;
 if (_mode='close' and p.status<>'approved') or (_mode<>'close' and p.status not in('draft','calculated')) then
  raise exception 'finance_payroll_period_protected' using errcode='55000';end if;
 if _entry is not null then
  select * into e from public.payroll_entries where id=_entry and tenant_id=_tenant and payroll_period_id=_period;
  if not found or e.status not in('draft','calculated') then raise exception 'finance_payroll_entry_protected' using errcode='55000';end if;
 elsif _mode='approve' and exists(select 1 from public.payroll_entries where tenant_id=_tenant and payroll_period_id=_period and status not in('draft','calculated','cancelled')) then
  raise exception 'finance_payroll_entry_protected' using errcode='55000';
 end if;
end$$;
revoke all on function finance_private.lock_payroll_lifecycle(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;

do $patch$declare spec record;definition text;body text;scope text;begin
 for spec in select * from (values
  ('generate_payroll_period(uuid,date,date,text,boolean,boolean)','generate'),
  ('approve_payroll_period(uuid)','approve'),('close_payroll_period(uuid,text)','close'),
  ('recompute_payroll_entry_totals(uuid)','entry'),('recalculate_payroll_entry(uuid)','entry'),
  ('add_payroll_manual_item(uuid,text,text,numeric,text)','entry'),('delete_payroll_entry_item(uuid,text)','item')
 )s(signature,kind) loop
  select pg_get_functiondef(('public.'||spec.signature)::regprocedure),prosrc into definition,body from pg_proc where oid=('public.'||spec.signature)::regprocedure;
  if position('<<finance_payroll_lifecycle_guard>>' in body)>0 then raise exception 'finance_payroll_lifecycle_already_wrapped';end if;
  scope:=case spec.kind
   when 'generate' then 'perform finance_private.lock_payroll_lifecycle(_tenant_id,null,null,''generate'');'
   when 'approve' then 'perform finance_private.lock_payroll_lifecycle((select tenant_id from public.payroll_periods where id=_period_id),_period_id,null,''approve'');'
   when 'close' then 'perform finance_private.lock_payroll_lifecycle((select tenant_id from public.payroll_periods where id=_period_id),_period_id,null,''close'');'
   when 'entry' then 'perform finance_private.lock_payroll_lifecycle((select tenant_id from public.payroll_entries where id=_entry_id),(select payroll_period_id from public.payroll_entries where id=_entry_id),_entry_id,''edit'');'
   else 'perform finance_private.lock_payroll_lifecycle((select tenant_id from public.payroll_entry_items where id=_item_id),(select payroll_period_id from public.payroll_entry_items where id=_item_id),(select payroll_entry_id from public.payroll_entry_items where id=_item_id),''edit'');' end;
  if spec.kind='approve' then
   if position('FOR _entry IN SELECT id FROM public.payroll_entries WHERE payroll_period_id = _period_id LOOP' in body)=0
    or position('UPDATE public.payroll_entry_items SET locked = true WHERE payroll_period_id = _period_id;' in body)=0 then raise exception 'finance_payroll_approval_contract_changed';end if;
   definition:=replace(definition,'FOR _entry IN SELECT id FROM public.payroll_entries WHERE payroll_period_id = _period_id LOOP','FOR _entry IN SELECT id FROM public.payroll_entries WHERE payroll_period_id = _period_id AND status IN (''draft'',''calculated'') ORDER BY id LOOP');
   definition:=replace(definition,'UPDATE public.payroll_entry_items SET locked = true WHERE payroll_period_id = _period_id;',
    'UPDATE public.payroll_entry_items SET locked = true WHERE payroll_period_id = _period_id AND EXISTS(SELECT 1 FROM public.payroll_entries e WHERE e.id=payroll_entry_items.payroll_entry_id AND e.status IN (''draft'',''calculated''));');
   -- Re-fetch modified source through a temporary installation to preserve wrappers.
   execute definition;
   select pg_get_functiondef(('public.'||spec.signature)::regprocedure),prosrc into definition,body from pg_proc where oid=('public.'||spec.signature)::regprocedure;
  end if;
  execute replace(definition,body,E'<<finance_payroll_lifecycle_guard>>\nBEGIN\n'||scope||E'\n'||body||E'\nEND finance_payroll_lifecycle_guard;');
 end loop;
end $patch$;

-- UI callers use the guarded commands. A trigger catches privileged legacy
-- writes without waiting in reverse order after a row has already been locked.
revoke insert,update,delete,truncate,references,trigger on public.payroll_periods,public.payroll_entries,public.payroll_entry_items from public,anon,authenticated;
create function finance_private.protect_payroll_write() returns trigger
language plpgsql security definer set search_path='' as $$declare t uuid;p uuid;e uuid;old_data jsonb;new_data jsonb;begin
 old_data:=case when tg_op='INSERT' then null else to_jsonb(old) end;new_data:=case when tg_op='DELETE' then null else to_jsonb(new) end;
 t:=coalesce((old_data->>'tenant_id')::uuid,(new_data->>'tenant_id')::uuid);
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if not pg_try_advisory_xact_lock(hashtextextended(t::text||':finance',0)) then raise exception 'finance_payroll_write_busy' using errcode='40001';end if;
 if tg_op='UPDATE' and (old_data->>'tenant_id',old_data->>'id',old_data->>'payroll_period_id',old_data->>'payroll_entry_id') is distinct from
  (new_data->>'tenant_id',new_data->>'id',new_data->>'payroll_period_id',new_data->>'payroll_entry_id') then raise exception 'finance_payroll_identity_immutable' using errcode='55000';end if;
 if tg_table_name='payroll_periods' then
  if tg_op<>'INSERT' and old_data->>'status' not in('draft','calculated') and not(tg_op='UPDATE' and old_data->>'status'='approved' and new_data->>'status'='closed'
    and old_data-array['status','closed_by','closed_at','notes','updated_at']=new_data-array['status','closed_by','closed_at','notes','updated_at']) then raise exception 'finance_payroll_period_protected' using errcode='55000';end if;
 else
  p:=coalesce((old_data->>'payroll_period_id')::uuid,(new_data->>'payroll_period_id')::uuid);
  perform id from public.payroll_periods where tenant_id=t and id=p and status in('draft','calculated') for update nowait;
  if not found then raise exception 'finance_payroll_period_protected' using errcode='55000';end if;
  if tg_table_name='payroll_entries' then
   if tg_op<>'INSERT' and old_data->>'status' not in('draft','calculated') then raise exception 'finance_payroll_entry_protected' using errcode='55000';end if;
  else
   e:=coalesce((old_data->>'payroll_entry_id')::uuid,(new_data->>'payroll_entry_id')::uuid);
   perform id from public.payroll_entries where id=e and tenant_id=t and payroll_period_id=p and status in('draft','calculated') for update nowait;
   if not found or (tg_op<>'INSERT' and old_data->>'locked'='true') then raise exception 'finance_payroll_entry_protected' using errcode='55000';end if;
  end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end$$;
revoke all on function finance_private.protect_payroll_write() from public,anon,authenticated,service_role;
create trigger finance_payroll_period_write before insert or update or delete on public.payroll_periods for each row execute function finance_private.protect_payroll_write();
create trigger finance_payroll_entry_write before insert or update or delete on public.payroll_entries for each row execute function finance_private.protect_payroll_write();
create trigger finance_payroll_item_write before insert or update or delete on public.payroll_entry_items for each row execute function finance_private.protect_payroll_write();
