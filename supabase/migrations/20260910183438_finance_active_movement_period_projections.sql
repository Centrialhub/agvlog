-- Only current projections change. Persisted closure snapshots are immutable.
create function finance_private.movement_correction_facts(_tenant uuid,_account uuid,_to date)
returns jsonb language sql stable security invoker set search_path='' as $$
 with corrected as materialized (
  select v.*,to_jsonb(m) original from public.finance_movement_voids v
  join public.finance_movements m on m.tenant_id=v.tenant_id and m.id=v.movement_id
  where v.tenant_id=_tenant and m.bank_account_id=_account and m.occurred_on<=_to
 ) select jsonb_build_object(
  'movement_voids',coalesce((select jsonb_agg(to_jsonb(c)-'original' order by c.id) from corrected c),'[]'::jsonb),
  'voided_movements',coalesce((select jsonb_agg(c.original order by c.movement_id) from corrected c),'[]'::jsonb)
 )
$$;
revoke all on function finance_private.movement_correction_facts(uuid,uuid,date) from public,anon,authenticated,service_role;

do $$declare body text;needle text;signature text;begin
 -- Both references compute book money: before the cut and within the cut.
 body:=pg_get_functiondef('finance_private.account_opening(uuid,uuid,date,date)'::regprocedure);
 needle:='from public.finance_movements';
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>2 then raise exception 'finance_active_opening_contract_changed';end if;
 execute replace(body,needle,'from finance_private.active_movements');

 -- Raw references in reconciliation groups remain available as anomaly evidence.
 body:=pg_get_functiondef('finance_private.account_period_review(uuid,uuid,date,date)'::regprocedure);
 needle:='select * from public.finance_movements where tenant_id=_tenant and bank_account_id=_account and occurred_on between _from and _to';
 if position(needle in body)=0 then raise exception 'finance_active_period_contract_changed';end if;
 execute replace(body,needle,replace(needle,'public.finance_movements','finance_private.active_movements'));

 for signature in select unnest(array[
  'finance_private.account_period_close_snapshot(uuid,uuid,date,date)',
  'finance_private.cash_period_close_snapshot(uuid,uuid,date,date,uuid)'
 ]) loop
  body:=pg_get_functiondef(signature::regprocedure);
  if signature like '%cash_period_close_snapshot%' then
   needle:='into inflow,outflow from public.finance_movements';
   if position(needle in body)=0 then raise exception 'finance_active_cash_totals_contract_changed';end if;
   body:=replace(body,needle,'into inflow,outflow from finance_private.active_movements');
   needle:='''movements'',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),''[]'') from public.finance_movements m';
  else
   needle:='with movements as materialized(select * from public.finance_movements';
  end if;
  if position(needle in body)=0 then raise exception 'finance_active_snapshot_contract_changed';end if;
  body:=replace(body,needle,replace(needle,'public.finance_movements','finance_private.active_movements'));
  needle:='with sources(kind,role,rows) as(values';
  if position(needle in body)=0 then raise exception 'finance_void_snapshot_sources_contract_changed';end if;
  body:=replace(body,needle,'facts:=facts||finance_private.movement_correction_facts(_tenant,_account,_to);'||chr(10)||needle||chr(10)||
   '(''finance_movement_voids'',''composition_snapshot'',facts->''movement_voids''),(''finance_movements'',''composition_snapshot'',facts->''voided_movements''),');
  execute body;
 end loop;
end$$;
