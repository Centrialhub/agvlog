-- One decision for both the UI snapshot and the final receipt insertion guard.
create function finance_private.receivable_fiscal_issue(_tenant uuid,_receivable uuid) returns text
language plpgsql stable security invoker set search_path='' as $$
declare origin public.finance_fiscal_receivable_origins%rowtype;legacy_cte uuid;
begin
 select * into origin from public.finance_fiscal_receivable_origins where tenant_id=_tenant and receivable_id=_receivable;
 if found then
  if origin.state<>'active' then return 'fiscal_origin_'||origin.state;end if;
  if not exists(select 1 from public.hub_fiscal_emissions e where e.tenant_id=_tenant and e.id=origin.emission_id
   and e.environment='production' and e.status in('authorized','cancel_rejected') and to_jsonb(e)->>'dispatch_state'='recorded') then
   return 'fiscal_authorization_unavailable';end if;
 else
  select cte_document_id into legacy_cte from public.receivables where tenant_id=_tenant and id=_receivable;
  if legacy_cte is not null and not exists(select 1 from public.hub_fiscal_emissions e where e.tenant_id=_tenant and e.cte_document_id=legacy_cte
   and e.environment='production' and e.status in('authorized','cancel_rejected') and to_jsonb(e)->>'dispatch_state'='recorded') then
   return 'fiscal_authorization_unavailable';end if;
 end if;
 return null;
end;$$;
revoke all on function finance_private.receivable_fiscal_issue(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function finance_private.guard_fiscal_receipt() returns trigger
language plpgsql security definer set search_path='' as $$begin
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||new.tenant_id::text,0));
 if finance_private.receivable_fiscal_issue(new.tenant_id,new.receivable_id) is not null then
  raise exception 'financial_fiscal_source_not_collectible' using errcode='22023';end if;
 return new;
end;$$;
revoke all on function finance_private.guard_fiscal_receipt() from public,anon,authenticated,service_role;

do $context$
declare body text;original text;
begin
 select pg_get_functiondef('public._receivable_financial_snapshot(uuid,uuid)'::regprocedure) into body;
 original:='return v_result||jsonb_build_object(''revision'',md5(v_result::text));';
 if position(original in body)=0 then raise exception 'finance_fiscal_context_contract_changed';end if;
 body:=replace(body,original,$new$
 v_result:=v_result||jsonb_build_object('fiscal_block_reason',finance_private.receivable_fiscal_issue(_tenant,_id));
 if v_result->>'fiscal_block_reason' is not null then v_result:=v_result||jsonb_build_object('can_receive',false);end if;
 return v_result||jsonb_build_object('revision',md5(v_result::text));$new$);
 execute body;
 -- Take the fiscal lock before receivable rows, matching the fiscal processor.
 -- The receipt trigger then reuses the transaction lock instead of inverting order.
 select pg_get_functiondef('public._lock_receivable_financial_graph(uuid,uuid)'::regprocedure) into body;
 original:='declare v_invoice uuid;begin';
 if position(original in body)=0 then raise exception 'finance_fiscal_graph_lock_contract_changed';end if;
 execute replace(body,original,original||E'\n perform pg_advisory_xact_lock(hashtextextended(''fiscal:''||_tenant::text,0));');
end;
$context$;
