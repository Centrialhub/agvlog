set lock_timeout='3s';set statement_timeout='30s';
do $$begin
 if to_regprocedure('finance_private.cash_forecast_collect_before_agenda(uuid,date,date)') is not null then raise exception 'finance_forecast_agenda_already_installed' using errcode='55000';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('finance_private.cash_forecast_collect(uuid,date,date)') and md5(replace(prosrc,E'\r\n',E'\n'))='f05aa53d0b085c6d89f177234a65b24c' and prosecdef and provolatile='s' and proconfig=array['search_path=""']::text[] and not has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute') and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) acl where acl.grantee<>proowner)) then raise exception 'finance_forecast_agenda_collector_changed' using errcode='55000';end if;
end$$;
create table finance_private.cash_forecast_agenda_events(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 economic_key text not null,source_table text not null check(source_table in('receivables','payables','fiscal_documents','delivery_attempts')),source_id uuid not null,
 ordinal bigint not null check(ordinal>0),previous_id uuid references finance_private.cash_forecast_agenda_events(id),
 action text not null check(action in('set','clear')),expected_on date,source_revision text not null check(source_revision~'^[a-f0-9]{32}$'),
 source_snapshot jsonb not null check(jsonb_typeof(source_snapshot)='object'),actor_id uuid not null,actor_name text not null,reason text not null check(length(btrim(reason)) between 5 and 2000),
 request_id uuid not null,payload_hash text not null,created_at timestamptz not null default clock_timestamp(),result jsonb not null,
 unique(tenant_id,request_id),unique(tenant_id,economic_key,ordinal),
 check(coalesce(source_snapshot->>'economic_key'=economic_key and source_snapshot->>'source_table'=source_table and source_snapshot->>'source_id'=source_id::text and source_snapshot->>'source_revision'=source_revision,false)),
 check(coalesce(result->>'event_id'=id::text and result->>'tenant_id'=tenant_id::text and result->>'actor_id'=actor_id::text and result->>'request_id'=request_id::text,false)),
 check((action='set' and expected_on is not null and isfinite(expected_on)) or(action='clear' and expected_on is null))
);
alter table finance_private.cash_forecast_agenda_events enable row level security;
revoke all on finance_private.cash_forecast_agenda_events from public,anon,authenticated,service_role;
create trigger preserve_cash_forecast_agenda before update or delete on finance_private.cash_forecast_agenda_events for each row execute function finance_private.preserve_event();
do $copy$declare body text;begin
 select pg_get_functiondef('finance_private.cash_forecast_collect(uuid,date,date)'::regprocedure) into body;
 if position('FUNCTION finance_private.cash_forecast_collect(' in body)=0 then raise exception 'finance_forecast_agenda_copy_invalid';end if;
 execute replace(body,'FUNCTION finance_private.cash_forecast_collect(','FUNCTION finance_private.cash_forecast_collect_before_agenda(');
end$copy$;
revoke all on function finance_private.cash_forecast_collect_before_agenda(uuid,date,date) from public,anon,authenticated,service_role;
create or replace function finance_private.cash_forecast_collect(_tenant uuid,_cutoff date,_period_end date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c jsonb;r jsonb;rows jsonb:='[]';history jsonb;last_event finance_private.cash_forecast_agenda_events%rowtype;agenda jsonb;issues jsonb;
begin
 perform finance_private.require_access(_tenant);c:=finance_private.cash_forecast_collect_before_agenda(_tenant,_cutoff,_period_end);issues:=c->'source_issues';
 for r in select value from jsonb_array_elements(c->'origins') loop
  select * into last_event from finance_private.cash_forecast_agenda_events where tenant_id=_tenant and economic_key=r->>'economic_key' order by ordinal desc limit 1;
  if found then
   select jsonb_agg(jsonb_build_object('id',e.id,'ordinal',e.ordinal,'previous_id',e.previous_id,'action',e.action,'expected_on',e.expected_on,'source_revision',e.source_revision,'original_expected_on',e.source_snapshot->'expected_on','original_expected_date_source',e.source_snapshot->'expected_date_source','actor_id',e.actor_id,'actor_name',e.actor_name,'reason',e.reason,'created_at',e.created_at) order by e.ordinal) into history from finance_private.cash_forecast_agenda_events e where e.tenant_id=_tenant and e.economic_key=r->>'economic_key';
   if last_event.source_table is distinct from r->>'source_table' or last_event.source_id::text is distinct from r->>'source_id' then raise exception 'finance_forecast_agenda_identity_invalid' using errcode='55000';end if;
   agenda:=jsonb_build_object('event_id',last_event.id,'revision',md5(history::text),'stale',last_event.action='set' and last_event.source_revision is distinct from r->>'source_revision','history',history);
   r:=r||jsonb_build_object('original_expected_on',r->'expected_on','original_expected_date_source',r->'expected_date_source','agenda',agenda);
   if last_event.action='set' then
    if agenda->'stale'='true'::jsonb then r:=r||jsonb_build_object('expected_on',null,'expected_date_source','unknown');issues:=issues||jsonb_build_array(jsonb_build_object('scope',case when r->>'scenario'='unbilled' then 'expanded' else 'confirmed' end,'code','forecast_agenda_source_changed','source_ids',jsonb_build_array(last_event.source_id)));
    else r:=r||jsonb_build_object('expected_on',last_event.expected_on,'expected_date_source','reviewed_date');end if;
   end if;
   r:=r||jsonb_build_object('source_revision',md5(jsonb_build_object('source',r->'source_revision','agenda',agenda)::text));
  end if;rows:=rows||jsonb_build_array(r);
 end loop;
 c:=c||jsonb_build_object('origins',rows,'source_issues',issues);
 return c||jsonb_build_object('revision',md5((c-'captured_at')::text));
end$$;
revoke all on function finance_private.cash_forecast_collect(uuid,date,date) from public,anon,authenticated,service_role;
create function finance_private.cash_forecast_agenda_preview(_tenant uuid,_cutoff date,_period_end date,_economic_key text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c jsonb;r jsonb;
begin
 perform finance_private.require_access(_tenant);c:=finance_private.cash_forecast_collect(_tenant,_cutoff,_period_end);
 select value into r from jsonb_array_elements(c->'origins') where value->>'economic_key'=_economic_key;
 if r is null then raise exception 'finance_forecast_agenda_source_missing' using errcode='22023';end if;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'cutoff',_cutoff,'period_end',_period_end,'revision',c->'revision','origin',r,'eligible',r->'valid'='true'::jsonb and (r->>'nominal_cents')::numeric>(r->>'fulfilled_cents')::numeric+(r->>'reserved_credit_cents')::numeric,'can_execute',false);
end$$;
revoke all on function finance_private.cash_forecast_agenda_preview(uuid,date,date,text) from public,anon,authenticated,service_role;
create function finance_private.record_cash_forecast_agenda(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;actor uuid:=auth.uid();req uuid;cut date;finish date;day date;preview jsonb;base jsonb;r jsonb;old finance_private.cash_forecast_agenda_events%rowtype;previous finance_private.cash_forecast_agenda_events%rowtype;fingerprint text;new_id uuid:=gen_random_uuid();result jsonb;name text;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_forecast_agenda_invalid' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;req:=(_payload->>'request_id')::uuid;perform finance_private.require_access(t);
 if coalesce(_payload->>'version','')<>'1' or req is null or coalesce(_payload->>'economic_key','')='' or coalesce(_payload->>'action','') not in('set','clear') or coalesce(length(btrim(_payload->>'reason')),0) not between 5 and 2000 or coalesce(_payload->>'expected_revision','')!~'^[a-f0-9]{32}$' or not(_payload?'expected_on') or exists(select 1 from jsonb_object_keys(_payload) k where k<>all(array['version','tenant_id','request_id','economic_key','action','expected_on','reason','expected_revision','cutoff','period_end'])) then raise exception 'finance_forecast_agenda_invalid' using errcode='22023';end if;
 cut:=(_payload->>'cutoff')::date;finish:=(_payload->>'period_end')::date;day:=(_payload->>'expected_on')::date;
 if cut is null or finish is null or not isfinite(cut) or not isfinite(finish) or (_payload->>'action'='set' and(day is null or not isfinite(day))) or(_payload->>'action'='clear' and day is not null) then raise exception 'finance_forecast_agenda_date_invalid' using errcode='22023';end if;
 fingerprint:=md5(_payload::text);perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor order by role::text for share nowait;
 perform 1 from public.drivers where tenant_id=t and user_id=actor order by id for share nowait;
 perform finance_private.require_access(t);
 if auth.uid() is distinct from actor then raise exception 'finance_forecast_agenda_actor_changed' using errcode='42501';end if;
 select * into old from finance_private.cash_forecast_agenda_events where tenant_id=t and request_id=req;
 if found then if old.actor_id is distinct from actor or old.payload_hash is distinct from fingerprint then raise exception 'finance_forecast_agenda_request_conflict' using errcode='23514';end if;return old.result;end if;
 if day<(clock_timestamp() at time zone 'America/Sao_Paulo')::date then raise exception 'finance_forecast_agenda_date_past' using errcode='22023';end if;
 -- Both STABLE readers share this statement snapshot. A later source change
 -- keeps the captured revision and makes the agenda stale, never silently rebases it.
 select finance_private.cash_forecast_agenda_preview(t,cut,finish,_payload->>'economic_key'),finance_private.cash_forecast_collect_before_agenda(t,cut,finish) into preview,base;
 if preview->>'revision' is distinct from _payload->>'expected_revision' then raise exception 'finance_forecast_agenda_changed' using errcode='40001';end if;
 if preview->'eligible' is distinct from 'true'::jsonb then raise exception 'finance_forecast_agenda_source_unavailable' using errcode='23514';end if;
 select value into r from jsonb_array_elements(base->'origins') where value->>'economic_key'=_payload->>'economic_key';
 select * into previous from finance_private.cash_forecast_agenda_events where tenant_id=t and economic_key=_payload->>'economic_key' order by ordinal desc limit 1;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into name from auth.users where id=actor;name:=coalesce(name,actor::text);
 result:=jsonb_build_object('version',1,'tenant_id',t,'actor_id',actor,'event_id',new_id,'request_id',req,'economic_key',r->'economic_key','action',_payload->'action','expected_on',day);
 insert into finance_private.cash_forecast_agenda_events(id,tenant_id,economic_key,source_table,source_id,ordinal,previous_id,action,expected_on,source_revision,source_snapshot,actor_id,actor_name,reason,request_id,payload_hash,result) values(new_id,t,r->>'economic_key',r->>'source_table',(r->>'source_id')::uuid,coalesce(previous.ordinal,0)+1,previous.id,_payload->>'action',day,r->>'source_revision',r,actor,name,btrim(_payload->>'reason'),req,fingerprint,result);
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(t,'cash_forecast_agenda',new_id,case when _payload->>'action'='set' then 'cash_forecast_agenda_set' else 'cash_forecast_agenda_cleared' end,actor,name,btrim(_payload->>'reason'),preview->'origin',result);
 perform finance_private.require_access(t);return result;
exception when lock_not_available then raise exception 'finance_forecast_agenda_busy' using errcode='40001';
end$$;
revoke all on function finance_private.record_cash_forecast_agenda(jsonb) from public,anon,authenticated,service_role;
create function finance_private.forecast_agenda_projection_input(v jsonb) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare r jsonb;clean jsonb:='[]';h jsonb;last_id text;ordinal bigint;
begin
 for r in select value from jsonb_array_elements(v->'origins') loop
  if r?'agenda' then
   perform finance_private.validate_forecast_json(jsonb_build_object('original_expected_on',r->'original_expected_on','original_expected_date_source',r->'original_expected_date_source','agenda',r->'agenda'),'{"original_expected_on":{"$nullable":"day"},"original_expected_date_source":{"$enum":["due_date","unknown"]},"agenda":{"event_id":"uuid","revision":"revision","stale":"boolean","history":{"$array":{"id":"uuid","ordinal":"count","previous_id":{"$nullable":"uuid"},"action":{"$enum":["set","clear"]},"expected_on":{"$nullable":"day"},"source_revision":"revision","original_expected_on":{"$nullable":"day"},"original_expected_date_source":{"$enum":["due_date","unknown"]},"actor_id":"uuid","actor_name":"nonempty","reason":"nonempty","created_at":"timestamp"}}}}');
   last_id:=null;ordinal:=0;
   for h in select value from jsonb_array_elements(r#>'{agenda,history}') loop
    ordinal:=ordinal+1;if (h->>'ordinal')::bigint<>ordinal or h->>'previous_id' is distinct from last_id or(h->>'action'='set') is distinct from(h->>'expected_on' is not null) then raise exception 'finance_forecast_agenda_history_invalid' using errcode='22023';end if;last_id:=h->>'id';
   end loop;
   if ordinal<>(select count(distinct x->>'id') from jsonb_array_elements(r#>'{agenda,history}')x) or ordinal=0 or r#>>'{agenda,event_id}' is distinct from last_id or md5((r#>'{agenda,history}')::text) is distinct from r#>>'{agenda,revision}' then raise exception 'finance_forecast_agenda_history_invalid' using errcode='22023';end if;
   if (r->>'original_expected_on' is null) is distinct from(r->>'original_expected_date_source'='unknown') then raise exception 'finance_forecast_agenda_metadata_invalid' using errcode='22023';end if;
   if h->>'action'='clear' then
    if r#>'{agenda,stale}' is distinct from 'false'::jsonb or r->'expected_on' is distinct from r->'original_expected_on' or r->'expected_date_source' is distinct from r->'original_expected_date_source' then raise exception 'finance_forecast_agenda_metadata_invalid' using errcode='22023';end if;
   elsif r#>'{agenda,stale}'='true'::jsonb then
    if r->'expected_on' is distinct from 'null'::jsonb or r->>'expected_date_source' is distinct from 'unknown' then raise exception 'finance_forecast_agenda_metadata_invalid' using errcode='22023';end if;
   elsif r->'expected_on' is distinct from h->'expected_on' or r->>'expected_date_source' is distinct from 'reviewed_date' then raise exception 'finance_forecast_agenda_metadata_invalid' using errcode='22023';end if;
  elsif r->>'expected_date_source'='reviewed_date' or r?'original_expected_on' or r?'original_expected_date_source' then raise exception 'finance_forecast_agenda_evidence_missing' using errcode='22023';end if;
  clean:=clean||jsonb_build_array(r-'agenda'-'original_expected_on'-'original_expected_date_source');
 end loop;
 return jsonb_set(v,'{origins}',clean);
end$$;
revoke all on function finance_private.forecast_agenda_projection_input(jsonb) from public,anon,authenticated,service_role;
do $projector$
declare body text;needle text:='"due_date","unknown"';
begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('finance_private.project_collected_cash_forecast(jsonb)') and md5(replace(prosrc,E'\r\n',E'\n'))='995d91c56dd8eb5bafdfeba5bd664896' and not prosecdef and provolatile='i' and proconfig=array['search_path=""']::text[] and not has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute') and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) acl where acl.grantee<>proowner)) then raise exception 'finance_forecast_agenda_projector_changed' using errcode='55000';end if;
 select pg_get_functiondef('finance_private.project_collected_cash_forecast(jsonb)'::regprocedure) into body;
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 or position('(row-''valid'')' in body)=0 then raise exception 'finance_forecast_agenda_projector_contract_changed';end if;
 body:=replace(body,needle,'"due_date","reviewed_date","unknown"');body:=replace(body,'validate_forecast_json(v,','validate_forecast_json(finance_private.forecast_agenda_projection_input(v),');body:=replace(body,'(row-''valid'')','(row-''valid''-''original_expected_on''-''original_expected_date_source''-''agenda'')');execute body;
end$projector$;

do $audit$declare p record;body text;needle text:='''identity_reviewed_manually'',''identity_review_reversed''';begin
 select * into p from pg_proc where oid=to_regprocedure('finance_private.audit_events(uuid,jsonb)');
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from '0efd075f0793baa6e919d8551d34ba92' or not p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[] or not has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') then raise exception 'finance_forecast_agenda_audit_changed' using errcode='55000';end if;
 body:=pg_get_functiondef(p.oid);
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>2 then raise exception 'finance_forecast_agenda_audit_contract_changed';end if;
 execute replace(body,needle,'''cash_forecast_agenda_set'',''cash_forecast_agenda_cleared'','||needle);
end$audit$;
