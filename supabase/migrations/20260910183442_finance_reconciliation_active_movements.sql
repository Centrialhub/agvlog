-- Only operational reconciliation selections change; decision snapshots/reversals stay immutable.
do $$declare signature text;body text;begin
 foreach signature in array array[
 'finance_private.reconciliation_context(uuid,uuid[],uuid[])',
 'finance_private.reconciliation_snapshot_internal(uuid,uuid[],uuid[])',
 'finance_private.reconciliation_options(uuid,uuid,text,text,integer)',
 'finance_private.process_automatic_reconciliation(uuid)',
 'finance_private.reconciliation_evidence_issue(uuid,uuid)'] loop
  body:=pg_get_functiondef(signature::regprocedure);
  if position('from public.finance_movements' in body)=0 then raise exception 'finance_active_reconciliation_contract_changed: %',signature;end if;
  body:=replace(body,'from public.finance_movements','from finance_private.active_movements');
  if signature='finance_private.reconciliation_evidence_issue(uuid,uuid)' then
   if position('if not found then return ''group_unavailable'';end if;' in body)=0 then raise exception 'finance_active_reconciliation_evidence_contract_changed';end if;
   body:=replace(body,'if not found then return ''group_unavailable'';end if;',$patch$if not found then return 'group_unavailable';end if;
 if (select count(*) from finance_private.active_movements m where m.tenant_id=_tenant and m.id=any(g.movement_ids))<>cardinality(g.movement_ids) then return 'movement_inactive';end if;$patch$);
  end if;
  execute body;
 end loop;
end;$$;

-- Residual owner/worker inserts must obey the same active-money boundary.
-- A row-first writer fails retryably instead of deadlocking a finance-first command.
create function finance_private.guard_reconciliation_active_movements() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not pg_try_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0)) then
  raise exception 'finance_dependency_busy' using errcode='40001';end if;
 if (select count(*) from finance_private.active_movements m where m.tenant_id=new.tenant_id and m.id=any(new.movement_ids))<>cardinality(new.movement_ids) then
  raise exception 'finance_reconciliation_movement_inactive' using errcode='23514';end if;
 return new;
end;$$;
revoke all on function finance_private.guard_reconciliation_active_movements() from public,anon,authenticated,service_role;
create trigger finance_reconciliation_active_movements before insert on public.finance_reconciliation_groups
 for each row execute function finance_private.guard_reconciliation_active_movements();
