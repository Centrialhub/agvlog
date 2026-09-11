-- Candidate integration; promote only after the reviewed credit core and combined tests.
set lock_timeout='3s';set statement_timeout='30s';
do $predecessors$declare p record;spec record;begin
 select * into p from pg_proc where oid=to_regprocedure('finance_private.cash_forecast_collect_before_agenda(uuid,date,date)');
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from 'f05aa53d0b085c6d89f177234a65b24c' or not p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner) then raise exception 'finance_forecast_credit_collector_changed' using errcode='55000';end if;
 select * into p from pg_proc where oid=to_regprocedure('finance_private.forecast_customer_credit_evidence(uuid,uuid)');
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from '0d52a40e865dba8396d54c1eaed99d90' or not p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner) then raise exception 'finance_forecast_credit_evidence_changed' using errcode='55000';end if;
 for spec in select * from(values
 ('finance_private.customer_credit_position(uuid,uuid)','9c7f511f9f20852086366abba5b2b56b',true),
 ('finance_private.customer_credit_source_evidence(uuid,uuid)','3184b4aa2eddc8ac7d7f831d6ffac48c',true),
 ('finance_private.receivable_credit_evidence(uuid,uuid)','d62bb1656e6be89b7753f44c6e5501dc',false),
 ('public._receivable_financial_snapshot(uuid,uuid)','473e509e0283627f5520dddfb36a083d',false)) v(signature,hash,is_definer) loop
  select * into p from pg_proc where oid=to_regprocedure(spec.signature);
  if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from spec.hash or p.prosecdef is distinct from spec.is_definer or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner) then raise exception 'finance_forecast_credit_core_changed:%',spec.signature using errcode='55000';end if;
 end loop;
end$predecessors$;
create or replace function finance_private.forecast_customer_credit_evidence(_tenant uuid,_credit uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.finance_customer_credits%rowtype;p jsonb;valid boolean;
begin
 perform finance_private.require_access(_tenant);
 select * into c from public.finance_customer_credits where tenant_id=_tenant and id=_credit;
 if not found then raise exception 'finance_customer_credit_missing' using errcode='22023';end if;
 p:=finance_private.customer_credit_position(_tenant,_credit);
 valid:=coalesce(p->'valid'='true'::jsonb and p->>'tenant_id'=_tenant::text and p->>'credit_id'=_credit::text and p->>'payer_id'=c.payer_id::text and p->>'available_cents'~'^(0|[1-9][0-9]{0,13})$' and p->>'revision'~'^[a-f0-9]{32}$',false);
 return jsonb_build_object('credit_id',c.id,'payer_id',c.payer_id,'source_payment_id',c.payment_id,'source_revision',md5(p::text),'amount_cents',case when valid then p->>'available_cents' end,'valid',valid);
end$$;
revoke all on function finance_private.forecast_customer_credit_evidence(uuid,uuid) from public,anon,authenticated,service_role;
do $collector$declare body text;needle text;replacement text;begin
 select pg_get_functiondef('finance_private.cash_forecast_collect_before_agenda(uuid,date,date)'::regprocedure) into body;
 needle:=$old$'fulfilled_cents',fulfilled::text,'reserved_credit_cents',case when valid then '0' end$old$;
 replacement:=$new$'fulfilled_cents',case when valid then ev->>'cash_received_cents' end,'reserved_credit_cents',case when valid then ev->>'credit_applied_cents' end$new$;
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'finance_forecast_credit_origin_contract_changed';end if;
 body:=replace(body,needle,replacement);
 needle:=$old$if valid then credit_total:=credit_total+c.amount_cents;else credit_valid:=false;end if;$old$;
 replacement:=$new$if valid then credit_total:=credit_total+(ev->>'amount_cents')::numeric;else credit_valid:=false;end if;$new$;
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'finance_forecast_credit_total_contract_changed';end if;
 body:=replace(body,needle,replacement);
 needle:=$old$issues:=issues||jsonb_build_array(jsonb_build_object('scope','all','code',case when valid then 'unassigned_customer_credit' else 'forecast_customer_credit_unverified' end,'source_ids',jsonb_build_array(c.id)));$old$;
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'finance_forecast_credit_issue_contract_changed';end if;
 body:=replace(body,needle,'if not valid or (ev->>''amount_cents'')::numeric>0 then '||needle||' end if;');
 execute body;
end$collector$;

-- Stale dates retain their history, but a fully settled verified origin has no future flow to schedule.
do $settled_agenda$declare p record;body text;needle text:=$old$issues:=issues||jsonb_build_array(jsonb_build_object('scope',case when r->>'scenario'='unbilled' then 'expanded' else 'confirmed' end,'code','forecast_agenda_source_changed','source_ids',jsonb_build_array(last_event.source_id)));$old$;begin
 select * into p from pg_proc where oid=to_regprocedure('finance_private.cash_forecast_collect(uuid,date,date)');
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from '0f9dfc28159c7012d5d241d60fbd42b6' or not p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner) then raise exception 'finance_forecast_settled_agenda_changed' using errcode='55000';end if;
 body:=pg_get_functiondef(p.oid);
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'finance_forecast_settled_agenda_contract_changed';end if;
 execute replace(body,needle,'if r->''valid'' is distinct from ''true''::jsonb or coalesce((r->>''nominal_cents'')::numeric-(r->>''fulfilled_cents'')::numeric-(r->>''reserved_credit_cents'')::numeric,1)>0 then '||needle||' end if;');
end$settled_agenda$;
