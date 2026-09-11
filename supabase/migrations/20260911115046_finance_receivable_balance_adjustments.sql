-- PRIVATE CANDIDATE. Balance adjustments are not cash receipts or bank movements.
set lock_timeout='3s';set statement_timeout='30s';
do $pins$declare spec record;p record;begin
 for spec in select * from(values
('finance_private.unloading_effective_origin(uuid,uuid)','0ac1970b51d0be4fbae5b6ba6da4e4db',true,false,'s'),
('finance_private.customer_credit_application_context(uuid, uuid, uuid, text, uuid)','147817459c401e86ca0e1647ae2cd9ca',true,false,'s'),
('finance_private.receivable_credit_list_fields(uuid, uuid)','ce51842319287273b305aae586db6818',false,false,'s'),
('finance_private.receivable_portfolio_summary(uuid, date, date, uuid)','cd10de42b2e3a1567dc2de034048e7f0',true,true,'s'),
('finance_private.release_receivable_customer_credits(uuid, uuid, text, uuid)','4f0decac7d15076018408b91077231e5',true,false,'v'),
('public._guard_receivable_ledger()','ccba9ce7b0afd669374dbc564d22be19',true,false,'v'),
('public._invoice_lifecycle_snapshot(uuid, uuid)','af796b4802563eb3435dab6dbed8046a',false,false,'s'),
('public._lock_receivable_financial_graph(uuid, uuid)','9030db2b4d1cd8b98293b279f121d6ea',false,false,'v'),
('public._recalc_receivable_received()','3ace7a905df9b11f0a1e1e3117f76ebb',true,false,'v'),
('public._receivable_financial_snapshot(uuid, uuid)','473e509e0283627f5520dddfb36a083d',false,false,'s'),
('public._receivable_ledger_evidence(uuid, uuid)','51dc0bea52d353a7b6407fb6faa50cf0',false,false,'s'),
('public._sync_receivable_financial_projection(uuid, uuid)','d28b1363a4b487f8d2caf118b0c7f8fe',false,false,'v')
,
('finance_private.audit_events(uuid, jsonb)','2647888bb5cf905f834981be5726618c',true,true,'s'),
('public.get_client_invoice_action_context(uuid, uuid)','c0b905334330cc06c1749e0ebbabb404',true,true,'s'),
('public.get_closing_report_action_context(uuid, uuid)','f00eee83af867523cab755ab8f1f9838',true,true,'v')
 )v(signature,hash,is_definer,auth_execute,volatility) loop
 select * into p from pg_proc where oid=to_regprocedure(spec.signature);
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from spec.hash or p.prosecdef is distinct from spec.is_definer
  or p.provolatile::text is distinct from spec.volatility or p.proconfig is distinct from array['search_path=""']::text[] or has_function_privilege('authenticated',p.oid,'execute') is distinct from spec.auth_execute
  or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee<>p.proowner and(not spec.auth_execute or a.grantee<>(select oid from pg_roles where rolname='authenticated') or a.privilege_type<>'EXECUTE' or a.is_grantable))
 then raise exception 'finance_receivable_adjustment_predecessor_changed:%',spec.signature using errcode='55000';end if;
 end loop;
end$pins$;

create table finance_private.receivable_balance_adjustment_events(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 receivable_id uuid not null references public.receivables(id),action text not null check(action in('apply','reverse')),
 kind text not null check(kind in('discount','loss')),adjustment_id uuid not null references finance_private.receivable_balance_adjustment_events(id),
 amount_cents bigint not null check(amount_cents>0 and amount_cents<=99999999999999),effective_on date not null check(isfinite(effective_on)),
 request_id uuid not null,actor_id uuid,actor_name text not null,reason text not null check(length(btrim(reason)) between 5 and 2000),
 observation_id uuid references public.finance_fiscal_observations(id),source_revision text not null,source_snapshot jsonb not null,
 payload_hash text not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,request_id),check((action='apply' and adjustment_id=id)or(action='reverse' and adjustment_id<>id)),
 check((actor_id is not null and observation_id is null)or(actor_id is null and observation_id is not null and action='reverse'))
);
create index receivable_balance_adjustment_target on finance_private.receivable_balance_adjustment_events(tenant_id,receivable_id,id);
create index receivable_balance_adjustment_original on finance_private.receivable_balance_adjustment_events(tenant_id,adjustment_id,id);
alter table finance_private.receivable_balance_adjustment_events enable row level security;
revoke all on finance_private.receivable_balance_adjustment_events from public,anon,authenticated,service_role;
create trigger preserve_receivable_balance_adjustment before update or delete on finance_private.receivable_balance_adjustment_events for each row execute function finance_private.preserve_event();

create function finance_private.receivable_adjustment_binding(_tenant uuid,_receivable uuid) returns text language sql stable security invoker set search_path='' as $$
 select md5(jsonb_build_object('tenant_id',r.tenant_id,'receivable_id',r.id,'payer_id',r.client_id,'amount',r.amount)::text)
 from public.receivables r where r.tenant_id=_tenant and r.id=_receivable;
$$;
revoke all on function finance_private.receivable_adjustment_binding(uuid,uuid) from public,anon,authenticated,service_role;
create function finance_private.receivable_adjustment_evidence(_tenant uuid,_receivable uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare d numeric;l numeric;history jsonb;valid boolean:=true;binding text;
begin
 binding:=finance_private.receivable_adjustment_binding(_tenant,_receivable);
 select coalesce(sum(case when action='apply' then amount_cents else -amount_cents end)filter(where kind='discount'),0),
 coalesce(sum(case when action='apply' then amount_cents else -amount_cents end)filter(where kind='loss'),0),
 coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]') into d,l,history
 from finance_private.receivable_balance_adjustment_events e where e.tenant_id=_tenant and e.receivable_id=_receivable;
 if d<0 or l<0 or binding is null then valid:=false;end if;
 if exists(select 1 from finance_private.receivable_balance_adjustment_events e where e.tenant_id=_tenant and e.receivable_id=_receivable and(
  e.source_snapshot->>'binding_revision' is distinct from binding
  or not((e.actor_id is not null and e.observation_id is null and exists(select 1 from public.finance_events a where a.tenant_id=e.tenant_id and a.entity_id=e.id
    and a.entity_type='receivable_balance_adjustment' and a.action=case when e.action='apply' then 'receivable_'||e.kind||'_applied' else 'receivable_balance_adjustment_reversed' end
    and a.actor_id=e.actor_id and a.after_data=e.result and a.before_data->>'revision'=e.source_revision))
   or(e.actor_id is null and e.action='reverse' and e.observation_id is not null and exists(select 1 from public.finance_fiscal_observations o
    join public.finance_fiscal_receivable_origins origin on origin.tenant_id=o.tenant_id and origin.emission_id=o.emission_id
    where o.tenant_id=e.tenant_id and o.id=e.observation_id and origin.receivable_id=e.receivable_id and o.snapshot->>'status'='cancelled' and o.snapshot->>'environment'='production'))))) then valid:=false;end if;
 if exists(select 1 from finance_private.receivable_balance_adjustment_events e where e.tenant_id=_tenant and e.receivable_id=_receivable and e.action='reverse'
  and not exists(select 1 from finance_private.receivable_balance_adjustment_events a where a.id=e.adjustment_id and a.tenant_id=e.tenant_id and a.receivable_id=e.receivable_id and a.kind=e.kind and a.action='apply'))
 or exists(select 1 from finance_private.receivable_balance_adjustment_events a where a.tenant_id=_tenant and a.receivable_id=_receivable and a.action='apply'
  and(select coalesce(sum(e.amount_cents),0) from finance_private.receivable_balance_adjustment_events e where e.adjustment_id=a.id and e.action='reverse')>a.amount_cents) then valid:=false;end if;
 return jsonb_build_object('valid',valid,'declared_adjustment_cents',(d+l)::text,'discount_cents',case when valid then d::text end,'loss_cents',case when valid then l::text end,
  'adjustment_cents',case when valid then(d+l)::text end,'event_count',jsonb_array_length(history),'history',history,'revision',md5(jsonb_build_object('binding',binding,'history',history)::text));
end$$;
revoke all on function finance_private.receivable_adjustment_evidence(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.assert_receivable_adjustment_period(_tenant uuid,_receivable uuid,_effective_on date) returns void language plpgsql stable security definer set search_path='' as $$
begin
 if _effective_on is null or not isfinite(_effective_on) then raise exception 'finance_adjustment_date_invalid' using errcode='22023';end if;
 if finance_private.closed_interval_exists(_tenant,null,_effective_on,_effective_on) then raise exception 'finance_adjustment_period_closed' using errcode='55000';end if;
 if exists(select 1 from public.finance_account_period_dependencies d join public.finance_account_period_closures c on c.tenant_id=d.tenant_id and c.id=d.closure_id
  where d.tenant_id=_tenant and d.dependency_role<>'composition_snapshot'
  and not exists(select 1 from public.finance_account_period_reopenings opened where opened.tenant_id=c.tenant_id and opened.closure_id=c.id)
  and((d.source_kind='receivables' and d.source_id=_receivable)
   or(d.source_kind='client_invoices' and exists(select 1 from public.client_invoices inv join public.receivables r on r.tenant_id=inv.tenant_id and(r.client_invoice_id=inv.id or inv.receivable_id=r.id) where r.tenant_id=_tenant and r.id=_receivable and inv.id=d.source_id))
   or(d.source_kind='closing_reports' and exists(select 1 from public.closing_reports report join public.receivables r on r.tenant_id=report.tenant_id and(r.closing_report_id=report.id or report.receivable_id=r.id or exists(select 1 from public.client_invoices inv where inv.tenant_id=r.tenant_id and(inv.id=r.client_invoice_id or inv.receivable_id=r.id) and report.client_invoice_id=inv.id)) where r.tenant_id=_tenant and r.id=_receivable and report.id=d.source_id))))
 then raise exception 'finance_adjustment_closed_dependency' using errcode='55000';end if;
end$$;
revoke all on function finance_private.assert_receivable_adjustment_period(uuid,uuid,date) from public,anon,authenticated,service_role;

create function finance_private.receivable_adjustment_composition(_snapshot jsonb) returns jsonb language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('amount_cents',_snapshot->>'amount_cents','cash_received_cents',_snapshot->>'cash_received_cents','credit_applied_cents',_snapshot->>'credit_applied_cents',
 'discount_cents',_snapshot->>'discount_cents','loss_cents',_snapshot->>'loss_cents','adjustment_cents',_snapshot->>'adjustment_cents','settled_cents',_snapshot->>'settled_cents','open_cents',_snapshot->>'open_cents');
$$;
revoke all on function finance_private.receivable_adjustment_composition(jsonb) from public,anon,authenticated,service_role;

do $ledger$declare body text;needle text;begin
 select pg_get_functiondef('public._receivable_ledger_evidence(uuid,uuid)'::regprocedure) into body;
 execute replace(body,'FUNCTION public._receivable_ledger_evidence(','FUNCTION finance_private.receivable_ledger_before_adjustments(');
 select pg_get_functiondef('public._guard_receivable_ledger()'::regprocedure) into body;
 needle:='select exists(select 1 from public.receivables_payments where tenant_id=old.tenant_id and receivable_id=old.id) into v_has;';
 if(length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'finance_adjustment_identity_guard_changed';end if;
 execute replace(body,needle,needle||' v_has:=v_has or exists(select 1 from finance_private.receivable_balance_adjustment_events where tenant_id=old.tenant_id and receivable_id=old.id);');
 select pg_get_functiondef('public._receivable_financial_snapshot(uuid,uuid)'::regprocedure) into body;
 needle:='return v_result||jsonb_build_object(''revision'',md5(v_result::text));';
 if(length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'finance_adjustment_snapshot_changed';end if;
 body:=replace(body,'declare r public.receivables%rowtype;','declare balance_adjustment jsonb;r public.receivables%rowtype;');
 body:=replace(body,needle,'balance_adjustment:=finance_private.receivable_adjustment_evidence(_tenant,_id); v_result:=v_result||jsonb_build_object(''discount_cents'',case when v_structural then (balance_adjustment->>''discount_cents'')::bigint end,''loss_cents'',case when v_structural then (balance_adjustment->>''loss_cents'')::bigint end,''adjustment_cents'',case when v_structural then (balance_adjustment->>''adjustment_cents'')::bigint end,''balance_adjustment_event_count'',balance_adjustment->''event_count'',''balance_adjustment_revision'',balance_adjustment->''revision''); '||needle);
 execute body;
end$ledger$;
revoke all on function finance_private.receivable_ledger_before_adjustments(uuid,uuid) from public,anon,authenticated,service_role;
create or replace function public._receivable_ledger_evidence(_tenant uuid,_id uuid) returns table(net numeric,payment_count bigint,valid boolean) language sql stable security invoker set search_path='' as $$
 select base.net+(adj.value->>'declared_adjustment_cents')::numeric/100,base.payment_count,base.valid and adj.value->'valid'='true'::jsonb
 from finance_private.receivable_ledger_before_adjustments(_tenant,_id)base cross join lateral(select finance_private.receivable_adjustment_evidence(_tenant,_id)value)adj;
$$;
revoke all on function public._receivable_ledger_evidence(uuid,uuid) from public,anon,authenticated,service_role;
create trigger recalc_receivable_balance_adjustment after insert on finance_private.receivable_balance_adjustment_events for each row execute function public._recalc_receivable_received();
create trigger zz_sync_receivable_balance_adjustment after insert on finance_private.receivable_balance_adjustment_events for each row execute function finance_private.sync_credit_application_projection();


create function finance_private.receivable_adjustment_date_source(_tenant uuid,_receivable uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r public.receivables%rowtype;row_value jsonb;effective_origin jsonb;source_revision text;source_table text;source_id uuid;raw text;minimum_on date;origin public.finance_fiscal_receivable_origins%rowtype;emission public.hub_fiscal_emissions%rowtype;
begin
 select * into r from public.receivables where tenant_id=_tenant and id=_receivable;
 if not found then raise exception 'finance_adjustment_receivable_missing' using errcode='22023';end if;
 select to_jsonb(c) into row_value from public.finance_unloading_charges c where c.tenant_id=_tenant and c.receivable_id=_receivable;
 if found then source_table:='finance_unloading_charges';source_id:=(row_value->>'id')::uuid;
  effective_origin:=finance_private.unloading_effective_origin(_tenant,source_id);source_revision:=effective_origin->>'revision';
  if effective_origin->'verified'='true'::jsonb then raw:=effective_origin->>'last_effective_on';end if;
 else
  select * into origin from public.finance_fiscal_receivable_origins where tenant_id=_tenant and receivable_id=_receivable;
  if found then select * into emission from public.hub_fiscal_emissions where tenant_id=_tenant and id=origin.emission_id;
   if emission.doc_type='nfse' then source_table:='nfse_documents';source_id:=emission.nfse_document_id;
    select to_jsonb(d) into row_value from public.nfse_documents d where d.tenant_id=_tenant and d.id=source_id;raw:=row_value->>'issue_date';
   elsif emission.cte_document_id is not null then source_table:='cte_documents';source_id:=emission.cte_document_id;
    select to_jsonb(d) into row_value from public.cte_documents d where d.tenant_id=_tenant and d.id=source_id;raw:=row_value->>'issued_at';
   else source_table:='fiscal_documents';source_id:=emission.fiscal_document_id;
    select to_jsonb(d) into row_value from public.fiscal_documents d where d.tenant_id=_tenant and d.id=source_id;raw:=row_value->>'issue_date';
   end if;
  elsif r.cte_document_id is not null then source_table:='cte_documents';source_id:=r.cte_document_id;
   select to_jsonb(d) into row_value from public.cte_documents d where d.tenant_id=_tenant and d.id=source_id;raw:=row_value->>'issued_at';
  elsif r.client_invoice_id is not null then source_table:='client_invoices';source_id:=r.client_invoice_id;
   select to_jsonb(d) into row_value from public.client_invoices d where d.tenant_id=_tenant and d.id=source_id and d.receivable_id=r.id;raw:=row_value->>'issue_date';
  else source_table:='receivables';source_id:=r.id;raw:=r.created_at::text;
  end if;
 end if;
 begin
  if raw ~ '^\d{4}-\d{2}-\d{2}$' then minimum_on:=raw::date;
  elsif raw is not null then minimum_on:=(raw::timestamptz at time zone 'America/Sao_Paulo')::date;end if;
 exception when invalid_datetime_format or datetime_field_overflow then minimum_on:=null;end;
 if minimum_on is not null and not isfinite(minimum_on) then minimum_on:=null;end if;
 return jsonb_build_object('source_table',source_table,'source_id',source_id,'source_revision',source_revision,'raw_date',raw,'minimum_effective_on',minimum_on,'verified',minimum_on is not null);
end$$;
revoke all on function finance_private.receivable_adjustment_date_source(uuid,uuid) from public,anon,authenticated,service_role;
create function finance_private.lock_receivable_adjustment_date_source(_tenant uuid,_receivable uuid) returns void language plpgsql security invoker set search_path='' as $$
declare source jsonb;begin
 source:=finance_private.receivable_adjustment_date_source(_tenant,_receivable);
 if source->>'source_table' not in('finance_unloading_charges','nfse_documents','cte_documents','fiscal_documents','client_invoices','receivables') then raise exception 'finance_adjustment_date_unproven' using errcode='23514';end if;
 execute format('select 1 from public.%I where tenant_id=$1 and id=$2 for share nowait',source->>'source_table') using _tenant,(source->>'source_id')::uuid;
end$$;
revoke all on function finance_private.lock_receivable_adjustment_date_source(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.receivable_balance_adjustment_context(_tenant uuid,_receivable uuid,_kind text,_amount text,_effective_on date,_adjustment uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.receivables%rowtype;a finance_private.receivable_balance_adjustment_events%rowtype;s jsonb;e jsonb;before_value jsonb;after_value jsonb;
 blockers jsonb:='[]';date_source jsonb;adjustment jsonb:=null;amount bigint;delta bigint;reversed numeric;remaining numeric;manager boolean;result jsonb;
begin
 perform finance_private.require_access(_tenant);manager:=coalesce(public.is_tenant_admin(_tenant),false);
 if _kind is null or _kind not in('discount','loss') or _amount is null or _amount!~'^[1-9][0-9]{0,13}$' or _effective_on is null or not isfinite(_effective_on)
  or _effective_on>(statement_timestamp() at time zone 'America/Sao_Paulo')::date then raise exception 'finance_adjustment_invalid' using errcode='22023';end if;
 amount:=_amount::bigint;delta:=case when _adjustment is null then amount else -amount end;
 select * into r from public.receivables where tenant_id=_tenant and id=_receivable;if not found then raise exception 'finance_adjustment_receivable_missing' using errcode='22023';end if;
 s:=public._receivable_financial_snapshot(_tenant,_receivable);e:=finance_private.receivable_adjustment_evidence(_tenant,_receivable);
 date_source:=finance_private.receivable_adjustment_date_source(_tenant,_receivable);
 if date_source->'verified' is distinct from 'true'::jsonb then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_adjustment_date_unproven','source_ids',jsonb_build_array(_receivable)));
 elsif _effective_on<(date_source->>'minimum_effective_on')::date then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_adjustment_date_before_source','source_ids',jsonb_build_array(_receivable)));end if;
 if not manager then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_adjustment_manager_required','source_ids',jsonb_build_array(_receivable)));end if;
 if s->'requires_reconciliation' is distinct from 'false'::jsonb or s->>'fiscal_block_reason' is not null or s->>'source_issue' is not null or e->'valid' is distinct from 'true'::jsonb then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_adjustment_source_requires_review','source_ids',jsonb_build_array(_receivable)));end if;
 if r.status='cancelled' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_adjustment_cancelled_title','source_ids',jsonb_build_array(_receivable)));end if;
 if _adjustment is null then
  if amount>coalesce((s->>'open_cents')::numeric,-1) then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_adjustment_exceeds_open','source_ids',jsonb_build_array(_receivable)));end if;
 else
  select * into a from finance_private.receivable_balance_adjustment_events where tenant_id=_tenant and receivable_id=_receivable and id=_adjustment and action='apply';
  if not found then raise exception 'finance_adjustment_original_missing' using errcode='22023';end if;
  select coalesce(sum(amount_cents),0) into reversed from finance_private.receivable_balance_adjustment_events where tenant_id=_tenant and adjustment_id=a.id and action='reverse';remaining:=a.amount_cents-reversed;
  adjustment:=jsonb_build_object('id',a.id,'kind',a.kind,'original_cents',a.amount_cents::text,'reversed_cents',reversed::text,'available_to_reverse_cents',case when remaining>=0 then remaining::text end,'effective_on',a.effective_on,'created_at',a.created_at,'actor_id',a.actor_id,'actor_name',a.actor_name,'reason',a.reason);
  if _effective_on<a.effective_on then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_adjustment_date_before_source','source_ids',jsonb_build_array(a.id)));end if;
  if a.kind<>_kind or remaining<amount then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_adjustment_reverse_unavailable','source_ids',jsonb_build_array(a.id)));end if;
 end if;
 begin perform finance_private.assert_receivable_adjustment_period(_tenant,_receivable,_effective_on);exception when sqlstate '55000' then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_adjustment_period_closed','source_ids',jsonb_build_array(_receivable)));end;
 before_value:=finance_private.receivable_adjustment_composition(s);
 after_value:=before_value||jsonb_build_object('discount_cents',case when s->>'discount_cents' is not null then ((s->>'discount_cents')::numeric+case when _kind='discount' then delta else 0 end)::text end,
  'loss_cents',case when s->>'loss_cents' is not null then ((s->>'loss_cents')::numeric+case when _kind='loss' then delta else 0 end)::text end,
  'adjustment_cents',case when s->>'adjustment_cents' is not null then ((s->>'adjustment_cents')::numeric+delta)::text end,
  'settled_cents',case when s->>'settled_cents' is not null then ((s->>'settled_cents')::numeric+delta)::text end,
  'open_cents',case when s->>'open_cents' is not null then ((s->>'open_cents')::numeric-delta)::text end);
 select jsonb_object_agg(key,case when value='null'::jsonb or value#>>'{}' ~ '^(0|[1-9][0-9]{0,13})$' then value else 'null'::jsonb end) into after_value from jsonb_each(after_value);
 result:=jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'receivable_id',_receivable,'action',case when _adjustment is null then 'apply' else 'reverse' end,
  'kind',_kind,'adjustment_id',_adjustment,'amount_cents',_amount,'effective_on',_effective_on,'eligible',blockers='[]'::jsonb,'can_adjust',manager,'can_execute',false,'blockers',blockers,
  'target',before_value||jsonb_build_object('receivable_id',r.id,'payer_id',r.client_id,'reference',s->>'reference','status',r.status,'revision',s->>'revision','source_issue',s->>'source_issue','fiscal_block_reason',s->>'fiscal_block_reason'),
  'adjustment',adjustment,'effects',jsonb_build_object('cash_changed',false,'nominal_changed',false,'adjustment_delta_cents',delta::text,'before',before_value,'after',after_value));
 return result||jsonb_build_object('revision',md5(jsonb_build_object('context',result,'adjustment_revision',e->>'revision','date_source',date_source)::text));
end$$;
revoke all on function finance_private.receivable_balance_adjustment_context(uuid,uuid,text,text,date,uuid) from public,anon,authenticated,service_role;

create function finance_private.record_receivable_balance_adjustment(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;actor uuid:=auth.uid();req uuid;target uuid;adjustment uuid;amount bigint;action text;kind text;day date;
 ctx jsonb;result jsonb;event_id uuid:=gen_random_uuid();old finance_private.receivable_balance_adjustment_events%rowtype;name text;after_ctx jsonb;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_adjustment_invalid' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;req:=(_payload->>'request_id')::uuid;target:=(_payload->>'receivable_id')::uuid;adjustment:=(_payload->>'adjustment_id')::uuid;action:=_payload->>'action';kind:=_payload->>'kind';day:=(_payload->>'effective_on')::date;
 perform finance_private.require_access(t);if not coalesce(public.is_tenant_admin(t),false) then raise exception 'finance_adjustment_manager_required' using errcode='42501';end if;
 if req is null or target is null or coalesce(_payload->>'version','')<>'1' or coalesce(action,'') not in('apply','reverse') or(action='apply') is distinct from(adjustment is null)
  or coalesce(kind,'') not in('discount','loss') or coalesce(_payload->>'amount_cents','')!~'^[1-9][0-9]{0,13}$' or coalesce(_payload->>'expected_revision','')!~'^[a-f0-9]{32}$'
  or coalesce(length(btrim(_payload->>'reason')),0) not between 5 and 2000 or day is null or not isfinite(day)
  or exists(select 1 from jsonb_object_keys(_payload) k where k<>all(array['version','tenant_id','request_id','receivable_id','action','kind','adjustment_id','amount_cents','effective_on','expected_revision','reason'])) then raise exception 'finance_adjustment_invalid' using errcode='22023';end if;
 amount:=(_payload->>'amount_cents')::bigint;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor order by role::text for share nowait;
 perform 1 from public.drivers where tenant_id=t and user_id=actor order by id for share nowait;
 perform finance_private.require_access(t);if auth.uid() is distinct from actor or not coalesce(public.is_tenant_admin(t),false) then raise exception 'finance_adjustment_manager_required' using errcode='42501';end if;
 select * into old from finance_private.receivable_balance_adjustment_events where tenant_id=t and request_id=req;
 if found then if old.actor_id is distinct from actor or old.payload_hash is distinct from md5(_payload::text) then raise exception 'finance_adjustment_request_conflict' using errcode='23514';end if;return old.result;end if;
 perform public._lock_receivable_financial_graph(t,target);perform finance_private.lock_receivable_adjustment_date_source(t,target);
 ctx:=finance_private.receivable_balance_adjustment_context(t,target,kind,_payload->>'amount_cents',day,adjustment);
 if ctx->>'revision' is distinct from _payload->>'expected_revision' then raise exception 'finance_adjustment_changed' using errcode='40001';end if;
 if ctx->'eligible' is distinct from 'true'::jsonb then raise exception 'finance_adjustment_unavailable' using errcode='23514';end if;
 perform finance_private.assert_receivable_adjustment_period(t,target,day);
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into name from auth.users where id=actor;name:=coalesce(name,actor::text);
 result:=jsonb_build_object('version',1,'confirmed',true,'tenant_id',t,'actor_id',actor,'request_id',req,'event_id',event_id,'adjustment_id',coalesce(adjustment,event_id),
  'receivable_id',target,'action',action,'kind',kind,'amount_cents',amount::text,'effective_on',day,'cash_movement_created',false,'effects',ctx->'effects');
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(t,'receivable_balance_adjustment',event_id,case when action='apply' then 'receivable_'||kind||'_applied' else 'receivable_balance_adjustment_reversed' end,actor,name,btrim(_payload->>'reason'),ctx,result);
 insert into finance_private.receivable_balance_adjustment_events(id,tenant_id,receivable_id,action,kind,adjustment_id,amount_cents,effective_on,request_id,actor_id,actor_name,reason,source_revision,source_snapshot,payload_hash,result)
 values(event_id,t,target,action,kind,coalesce(adjustment,event_id),amount,day,req,actor,name,btrim(_payload->>'reason'),ctx->>'revision',
  jsonb_build_object('binding_revision',finance_private.receivable_adjustment_binding(t,target),'date_source',finance_private.receivable_adjustment_date_source(t,target)),md5(_payload::text),result);
 after_ctx:=public._receivable_financial_snapshot(t,target);
 if after_ctx->'requires_reconciliation' is distinct from 'false'::jsonb or finance_private.receivable_adjustment_composition(after_ctx) is distinct from ctx#>'{effects,after}' then raise exception 'finance_adjustment_projection_failed' using errcode='55000';end if;
 perform finance_private.require_access(t);if auth.uid() is distinct from actor or not coalesce(public.is_tenant_admin(t),false) then raise exception 'finance_adjustment_manager_required' using errcode='42501';end if;return result;
exception when lock_not_available then raise exception 'finance_adjustment_busy' using errcode='40001';
end$$;
revoke all on function finance_private.record_receivable_balance_adjustment(jsonb) from public,anon,authenticated,service_role;

create function finance_private.guard_receivable_balance_adjustment() returns trigger language plpgsql security definer set search_path='' as $$
declare ctx jsonb;a finance_private.receivable_balance_adjustment_events%rowtype;available numeric;proof jsonb;date_source jsonb;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('fiscal:'||new.tenant_id::text,0)) or not pg_try_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0)) then raise exception 'finance_adjustment_busy' using errcode='40001';end if;
 perform 1 from public.receivables where tenant_id=new.tenant_id and id=new.receivable_id for share nowait;
 if not found or new.source_snapshot->>'binding_revision' is distinct from finance_private.receivable_adjustment_binding(new.tenant_id,new.receivable_id) then raise exception 'finance_adjustment_binding_invalid' using errcode='23514';end if;
 perform finance_private.assert_receivable_adjustment_period(new.tenant_id,new.receivable_id,new.effective_on);
 date_source:=finance_private.receivable_adjustment_date_source(new.tenant_id,new.receivable_id);
 if date_source->'verified' is distinct from 'true'::jsonb or new.effective_on<(date_source->>'minimum_effective_on')::date or new.source_snapshot->'date_source' is distinct from date_source then raise exception 'finance_adjustment_date_before_source' using errcode='23514';end if;
 if new.observation_id is null then
  if auth.uid() is distinct from new.actor_id then raise exception 'finance_adjustment_actor_invalid' using errcode='42501';end if;
  ctx:=finance_private.receivable_balance_adjustment_context(new.tenant_id,new.receivable_id,new.kind,new.amount_cents::text,new.effective_on,case when new.action='reverse' then new.adjustment_id end);
  if ctx->'eligible' is distinct from 'true'::jsonb or ctx->>'revision' is distinct from new.source_revision or ctx->'effects' is distinct from new.result->'effects'
   or not exists(select 1 from public.finance_events audit where audit.tenant_id=new.tenant_id and audit.entity_id=new.id and audit.entity_type='receivable_balance_adjustment'
    and audit.action=case when new.action='apply' then 'receivable_'||new.kind||'_applied' else 'receivable_balance_adjustment_reversed' end and audit.actor_id=new.actor_id and audit.after_data=new.result and audit.before_data=ctx)
   then raise exception 'finance_adjustment_command_unproven' using errcode='23514';end if;
 else
  if new.actor_id is not null or new.action<>'reverse' or not exists(select 1 from public.finance_fiscal_observations o
   join public.finance_fiscal_receivable_origins origin on origin.tenant_id=o.tenant_id and origin.emission_id=o.emission_id
   join public.hub_fiscal_emissions emission on emission.tenant_id=o.tenant_id and emission.id=o.emission_id
   where o.tenant_id=new.tenant_id and o.id=new.observation_id and origin.receivable_id=new.receivable_id and o.snapshot->>'status'='cancelled' and o.snapshot->>'environment'='production'
    and emission.status='cancelled' and emission.environment='production' and emission.dispatch_state='recorded') then raise exception 'finance_adjustment_cancellation_unproven' using errcode='23514';end if;
  select * into a from finance_private.receivable_balance_adjustment_events where tenant_id=new.tenant_id and receivable_id=new.receivable_id and id=new.adjustment_id and action='apply' and kind=new.kind;
  if not found then raise exception 'finance_adjustment_original_missing' using errcode='23514';end if;
  select a.amount_cents-coalesce(sum(amount_cents),0) into available from finance_private.receivable_balance_adjustment_events where tenant_id=new.tenant_id and adjustment_id=a.id and action='reverse';
  proof:=finance_private.receivable_adjustment_evidence(new.tenant_id,new.receivable_id);
  if proof->'valid' is distinct from 'true'::jsonb or new.amount_cents>available or new.effective_on<a.effective_on then raise exception 'finance_adjustment_reverse_unavailable' using errcode='23514';end if;
 end if;
 return new;
exception when lock_not_available then raise exception 'finance_adjustment_busy' using errcode='40001';end$$;
revoke all on function finance_private.guard_receivable_balance_adjustment() from public,anon,authenticated,service_role;
create trigger guard_receivable_balance_adjustment before insert on finance_private.receivable_balance_adjustment_events for each row execute function finance_private.guard_receivable_balance_adjustment();
create function finance_private.verify_receivable_balance_adjustment() returns trigger language plpgsql security definer set search_path='' as $$
declare e jsonb;s jsonb;begin
 e:=finance_private.receivable_adjustment_evidence(new.tenant_id,new.receivable_id);s:=public._receivable_financial_snapshot(new.tenant_id,new.receivable_id);
 if e->'valid' is distinct from 'true'::jsonb or s->'requires_reconciliation' is distinct from 'false'::jsonb then raise exception 'finance_adjustment_chain_invalid' using errcode='23514';end if;return new;
end$$;
revoke all on function finance_private.verify_receivable_balance_adjustment() from public,anon,authenticated,service_role;
create constraint trigger verify_receivable_balance_adjustment after insert on finance_private.receivable_balance_adjustment_events deferrable initially deferred for each row execute function finance_private.verify_receivable_balance_adjustment();

create function finance_private.reverse_receivable_balance_adjustments(_tenant uuid,_receivable uuid,_reason text,_observation uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare a record;amount numeric;day date:=(statement_timestamp() at time zone 'America/Sao_Paulo')::date;ctx jsonb;id uuid;req uuid;result jsonb;s jsonb;before_value jsonb;after_value jsonb;proof jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||_tenant::text,0));perform pg_advisory_xact_lock(hashtextextended(_tenant::text||':finance',0));
 for a in select e.*,e.amount_cents-(select coalesce(sum(x.amount_cents),0) from finance_private.receivable_balance_adjustment_events x where x.tenant_id=e.tenant_id and x.adjustment_id=e.id and x.action='reverse') remaining
  from finance_private.receivable_balance_adjustment_events e where e.tenant_id=_tenant and e.receivable_id=_receivable and e.action='apply' order by e.id loop
  if a.remaining=0 then continue;end if;
  if a.remaining<0 then raise exception 'finance_adjustment_chain_invalid' using errcode='23514';end if;
  if _observation is null then
   ctx:=finance_private.receivable_balance_adjustment_context(_tenant,_receivable,a.kind,a.remaining::text,day,a.id);
   perform finance_private.record_receivable_balance_adjustment(jsonb_build_object('version',1,'tenant_id',_tenant,'request_id',gen_random_uuid(),'receivable_id',_receivable,
    'action','reverse','kind',a.kind,'adjustment_id',a.id,'amount_cents',a.remaining::text,'effective_on',day,'expected_revision',ctx->>'revision','reason',_reason));
  else
   perform finance_private.lock_receivable_adjustment_date_source(_tenant,_receivable);
   perform finance_private.assert_receivable_adjustment_period(_tenant,_receivable,day);
   s:=public._receivable_financial_snapshot(_tenant,_receivable);proof:=finance_private.receivable_adjustment_evidence(_tenant,_receivable);
   if proof->'valid' is distinct from 'true'::jsonb then raise exception 'finance_adjustment_chain_invalid' using errcode='23514';end if;
   before_value:=finance_private.receivable_adjustment_composition(s);amount:=a.remaining;
   after_value:=before_value||jsonb_build_object('discount_cents',((s->>'discount_cents')::numeric-case when a.kind='discount' then amount else 0 end)::text,
    'loss_cents',((s->>'loss_cents')::numeric-case when a.kind='loss' then amount else 0 end)::text,'adjustment_cents',((s->>'adjustment_cents')::numeric-amount)::text,
    'settled_cents',((s->>'settled_cents')::numeric-amount)::text,'open_cents',((s->>'open_cents')::numeric+amount)::text);
   id:=gen_random_uuid();req:=gen_random_uuid();
   result:=jsonb_build_object('version',1,'confirmed',true,'tenant_id',_tenant,'actor_id',null,'request_id',req,'event_id',id,'adjustment_id',a.id,'receivable_id',_receivable,'action','reverse','kind',a.kind,
    'amount_cents',amount::text,'effective_on',day,'cash_movement_created',false,'observation_id',_observation,
    'effects',jsonb_build_object('cash_changed',false,'nominal_changed',false,'adjustment_delta_cents',(-amount)::text,'before',before_value,'after',after_value));
   insert into finance_private.receivable_balance_adjustment_events(id,tenant_id,receivable_id,action,kind,adjustment_id,amount_cents,effective_on,request_id,actor_id,actor_name,reason,observation_id,source_revision,source_snapshot,payload_hash,result)
   values(id,_tenant,_receivable,'reverse',a.kind,a.id,amount::bigint,day,req,null,'Processamento fiscal',_reason,_observation,proof->>'revision',jsonb_build_object('binding_revision',finance_private.receivable_adjustment_binding(_tenant,_receivable),'date_source',finance_private.receivable_adjustment_date_source(_tenant,_receivable)),md5(result::text),result);
  end if;
 end loop;
end$$;
revoke all on function finance_private.reverse_receivable_balance_adjustments(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
do $cancel_hook$declare body text;needle text;begin
 select pg_get_functiondef('finance_private.release_receivable_customer_credits(uuid,uuid,text,uuid)'::regprocedure) into body;
 needle:='for a in select app.*';
 if(length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'finance_adjustment_cancel_hook_changed';end if;
 execute replace(body,needle,'perform finance_private.reverse_receivable_balance_adjustments(_tenant,_receivable,_reason,_observation); '||needle);
end$cancel_hook$;

create function finance_private.receivable_balance_adjustment_history(_tenant uuid,_receivable uuid,_query jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare off integer;lim integer;e jsonb;rev text;total bigint;rows jsonb;
begin
 perform finance_private.require_access(_tenant);
 if jsonb_typeof(_query) is distinct from 'object' or exists(select 1 from jsonb_object_keys(_query)k where k<>all(array['offset','limit','expected_revision']))
  or (_query->>'expected_revision' is not null and _query->>'expected_revision'!~'^[a-f0-9]{32}$') or coalesce(_query->>'offset','0')!~'^[0-9]{1,9}$' or coalesce(_query->>'limit','30')!~'^[0-9]{1,3}$' then raise exception 'finance_adjustment_history_query_invalid' using errcode='22023';end if;
 off:=coalesce((_query->>'offset')::integer,0);lim:=coalesce((_query->>'limit')::integer,30);if lim not between 1 and 100 then raise exception 'finance_adjustment_history_query_invalid' using errcode='22023';end if;
 if not exists(select 1 from public.receivables where tenant_id=_tenant and id=_receivable) then raise exception 'finance_adjustment_receivable_missing' using errcode='22023';end if;
 e:=finance_private.receivable_adjustment_evidence(_tenant,_receivable);if e->'valid' is distinct from 'true'::jsonb then raise exception 'finance_adjustment_chain_invalid' using errcode='55000';end if;
 rev:=md5(jsonb_build_object('tenant',_tenant,'actor',auth.uid(),'receivable',_receivable,'evidence_revision',e->>'revision')::text);
 if _query->>'expected_revision' is not null and _query->>'expected_revision' is distinct from rev then raise exception 'finance_adjustment_history_changed' using errcode='40001';end if;
 select count(*) into total from finance_private.receivable_balance_adjustment_events where tenant_id=_tenant and receivable_id=_receivable;
 if off>total then raise exception 'finance_adjustment_history_query_invalid' using errcode='22023';end if;
 select coalesce(jsonb_agg(value order by created_at desc,id desc),'[]') into rows from(
  select e.created_at,e.id,jsonb_build_object('id',e.id,'adjustment_id',e.adjustment_id,'action',e.action,'kind',e.kind,'amount_cents',e.amount_cents::text,
   'effective_on',e.effective_on,'created_at',e.created_at,'actor_id',e.actor_id,'actor_name',e.actor_name,'reason',e.reason,'observation_id',e.observation_id,
   'available_to_reverse_cents',case when e.action='apply' then(e.amount_cents-(select coalesce(sum(x.amount_cents),0) from finance_private.receivable_balance_adjustment_events x where x.tenant_id=e.tenant_id and x.adjustment_id=e.id and x.action='reverse'))::text end)value
  from finance_private.receivable_balance_adjustment_events e where e.tenant_id=_tenant and e.receivable_id=_receivable order by e.created_at desc,e.id desc offset off limit lim
 )page;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'receivable_id',_receivable,'offset',off,'limit',lim,'total',total,
  'next_offset',case when off+jsonb_array_length(rows)<total then off+jsonb_array_length(rows) end,'revision',rev,'rows',rows,'can_execute',false);
end$$;
revoke all on function finance_private.receivable_balance_adjustment_history(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

do $readers$declare body text;needle text;spec record;begin
 select pg_get_functiondef('finance_private.receivable_credit_list_fields(uuid,uuid)'::regprocedure) into body;
 needle:='''credit_applied_cents'',case when valid then s->>''credit_applied_cents'' end,';
 if(length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'finance_adjustment_page_contract_changed';end if;
 execute replace(body,needle,needle||'''discount_cents'',case when valid then s->>''discount_cents'' end,''loss_cents'',case when valid then s->>''loss_cents'' end,''adjustment_cents'',case when valid then s->>''adjustment_cents'' end,');
 select pg_get_functiondef('finance_private.customer_credit_application_context(uuid,uuid,uuid,text,uuid)'::regprocedure) into body;
 needle:='''credit_applied_cents'',target->>''credit_applied_cents'',';
 if(length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'finance_adjustment_credit_context_changed';end if;
 execute replace(body,needle,needle||'''discount_cents'',target->>''discount_cents'',''loss_cents'',target->>''loss_cents'',''adjustment_cents'',target->>''adjustment_cents'',');
 select pg_get_functiondef('public._invoice_lifecycle_snapshot(uuid,uuid)'::regprocedure) into body;
 needle:='return v_result||jsonb_build_object(''revision'',md5(v_result::text));';
 if(length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'finance_adjustment_invoice_context_changed';end if;
 body:=replace(body,'declare inv public.client_invoices%rowtype;','declare financial_composition jsonb;inv public.client_invoices%rowtype;');
 execute replace(body,needle,'if r.id is not null then financial_composition:=public._receivable_financial_snapshot(_tenant,r.id); v_result:=v_result||jsonb_build_object(''cash_received_cents'',financial_composition->''cash_received_cents'',''credit_applied_cents'',financial_composition->''credit_applied_cents'',''discount_cents'',financial_composition->''discount_cents'',''loss_cents'',financial_composition->''loss_cents'',''adjustment_cents'',financial_composition->''adjustment_cents'',''settled_cents'',financial_composition->''settled_cents'',''balance_adjustment_event_count'',financial_composition->''balance_adjustment_event_count'',''balance_adjustment_revision'',financial_composition->''balance_adjustment_revision'');end if; '||needle);
end$readers$;

do $closing_audit$declare body text;needle text;begin
 select pg_get_functiondef('public.get_closing_report_action_context(uuid,uuid)'::regprocedure) into body;
 needle:='return jsonb_build_object(''version'',1,''tenant_id'',r.tenant_id';
 if(length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'finance_adjustment_closing_context_changed';end if;
 body:=replace(body,'declare r public.closing_reports%rowtype;','declare financial_composition jsonb;r public.closing_reports%rowtype;');
 body:=replace(body,needle,'if r.receivable_id is not null and exists(select 1 from public.receivables where tenant_id=_tenant_id and id=r.receivable_id) then financial_composition:=public._receivable_financial_snapshot(_tenant_id,r.receivable_id);end if; '||needle);
 needle:='''allowed_actions'',actions);';
 if(length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'finance_adjustment_closing_return_changed';end if;
 execute replace(body,needle,'''allowed_actions'',actions,''cash_received_cents'',financial_composition->''cash_received_cents'',''credit_applied_cents'',financial_composition->''credit_applied_cents'',''discount_cents'',financial_composition->''discount_cents'',''loss_cents'',financial_composition->''loss_cents'',''adjustment_cents'',financial_composition->''adjustment_cents'',''settled_cents'',financial_composition->''settled_cents'',''balance_adjustment_event_count'',coalesce(financial_composition->''balance_adjustment_event_count'',''0''::jsonb),''balance_adjustment_revision'',financial_composition->''balance_adjustment_revision'');');
 select pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure) into body;
 needle:='''customer_credit_refunded'',';
 if(length(body)-length(replace(body,needle,'')))/length(needle)<>2 then raise exception 'finance_adjustment_audit_classification_changed';end if;
 execute replace(body,needle,needle||'''receivable_discount_applied'',''receivable_loss_applied'',''receivable_balance_adjustment_reversed'',');
end$closing_audit$;

do $bulk$declare body text;spec record;begin
 select pg_get_functiondef('finance_private.receivable_portfolio_summary(uuid,date,date,uuid)'::regprocedure) into body;
 for spec in select * from(values
($old$), graph as materialized($old$,$new$), adjustments as materialized(
 select refs.receivable_id,finance_private.receivable_adjustment_evidence(_tenant,refs.receivable_id) value
 from(select distinct e.receivable_id from finance_private.receivable_balance_adjustment_events e join active a on a.id=e.receivable_id and a.numeric_valid where e.tenant_id=_tenant)refs
 ), graph as materialized($new$),
($old$select a.*,coalesce(cash.net,0) cash_net,coalesce(credits.applied,0) credit_cents,$old$,$new$select a.*,coalesce(cash.net,0) cash_net,coalesce(credits.applied,0) credit_cents,
   coalesce((adjustments.value->>'discount_cents')::numeric,0) discount_cents,coalesce((adjustments.value->>'loss_cents')::numeric,0) loss_cents,
   coalesce((adjustments.value->>'declared_adjustment_cents')::numeric,0) adjustment_cents,$new$),
($old$coalesce(cash.net,0)+coalesce(credits.applied,0)/100 net,$old$,$new$coalesce(cash.net,0)+coalesce(credits.applied,0)/100+coalesce((adjustments.value->>'declared_adjustment_cents')::numeric,0)/100 net,$new$),
($old$and coalesce(credits.applied,0)>=0 ledger_valid,$old$,$new$and coalesce(credits.applied,0)>=0 and(adjustments.value is null or coalesce(adjustments.value->'valid'='true'::jsonb,false)) ledger_valid,$new$),
($old$left join cash on cash.receivable_id=a.id left join credits on credits.receivable_id=a.id$old$,$new$left join cash on cash.receivable_id=a.id left join credits on credits.receivable_id=a.id left join adjustments on adjustments.receivable_id=a.id$new$),
($old$case when valid then credit_cents end credit_applied,$old$,$new$case when valid then credit_cents end credit_applied,case when valid then discount_cents end discount,case when valid then loss_cents end loss,case when valid then adjustment_cents end adjusted,$new$),
($old$coalesce(sum(credit_applied),0) credit_applied,$old$,$new$coalesce(sum(credit_applied),0) credit_applied,coalesce(sum(discount),0) discount,coalesce(sum(loss),0) loss,coalesce(sum(adjusted),0) adjusted,$new$),
($old$sum(credit_applied) credit_applied,sum(remaining) remaining$old$,$new$sum(credit_applied) credit_applied,sum(discount) discount,sum(loss) loss,sum(adjusted) adjusted,sum(remaining) remaining$new$),
($old$'credit_applied_cents',case when s.invalid=0 then s.credit_applied::text end,$old$,$new$'credit_applied_cents',case when s.invalid=0 then s.credit_applied::text end,'discount_cents',case when s.invalid=0 then s.discount::text end,'loss_cents',case when s.invalid=0 then s.loss::text end,'adjustment_cents',case when s.invalid=0 then s.adjusted::text end,$new$),
($old$'credit_applied_cents',case when s.invalid=0 then g.credit_applied::text end,$old$,$new$'credit_applied_cents',case when s.invalid=0 then g.credit_applied::text end,'discount_cents',case when s.invalid=0 then g.discount::text end,'loss_cents',case when s.invalid=0 then g.loss::text end,'adjustment_cents',case when s.invalid=0 then g.adjusted::text end,$new$)
 )v(needle,replacement) loop
 if(length(body)-length(replace(body,spec.needle,'')))/length(spec.needle)<>1 then raise exception 'finance_adjustment_bulk_contract_changed:%',spec.needle;end if;
 body:=replace(body,spec.needle,spec.replacement);end loop;execute body;
end$bulk$;
