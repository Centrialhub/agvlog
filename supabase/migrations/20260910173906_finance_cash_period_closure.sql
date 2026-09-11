create table public.finance_cash_period_counts(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,account_id uuid not null,period_end date not null,
 evidence_type text not null default 'cash_count_v1' check(evidence_type='cash_count_v1'),currency text not null default 'BRL' check(currency='BRL'),timezone text not null default 'America/Sao_Paulo' check(timezone='America/Sao_Paulo'),boundary text not null default 'end_of_day' check(boundary='end_of_day'),
 counts jsonb not null,total_cents bigint not null check(total_cents between 0 and 99999999999999),custodian_name text not null check(length(btrim(custodian_name)) between 2 and 200),actor_id uuid not null,actor_name text not null,reason text not null check(length(btrim(reason)) between 10 and 2000),request_id uuid not null,revision text not null,created_at timestamptz not null default clock_timestamp(),unique(tenant_id,id),unique(tenant_id,request_id)
);
create index finance_cash_count_period on public.finance_cash_period_counts(tenant_id,account_id,period_end);
create table public.finance_cash_period_count_reversals(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,count_id uuid not null,expected_revision text not null,actor_id uuid not null,actor_name text not null,reason text not null check(length(btrim(reason)) between 10 and 2000),request_id uuid not null,created_at timestamptz not null default clock_timestamp(),unique(tenant_id,count_id),unique(tenant_id,request_id),foreign key(tenant_id,count_id) references public.finance_cash_period_counts(tenant_id,id)
);
do $$declare t text;begin foreach t in array array['finance_cash_period_counts','finance_cash_period_count_reversals'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);execute format('grant select on public.%I to authenticated',t);
 execute format('create policy finance_cash_count_read on public.%I for select to authenticated using(finance_private.can_access(tenant_id))',t);
 execute format('create trigger preserve_cash_count before update or delete on public.%I for each row execute function finance_private.preserve_event()',t);
end loop;end$$;
alter table public.finance_account_period_dependencies drop constraint finance_account_period_dependencies_dependency_role_check;
alter table public.finance_account_period_dependencies add constraint finance_account_period_dependencies_dependency_role_check check(dependency_role in('money','bank_evidence','cash_evidence','opening','predecessor','legacy_review','composition_snapshot'));
create function finance_private.validate_cash_period_count() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.finance_cash_period_counts%rowtype;begin
 if not pg_try_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0)) then raise exception 'finance_cash_count_busy' using errcode='40001';end if;
 if not finance_private.can_access(new.tenant_id) or new.actor_id is distinct from auth.uid() then raise exception 'finance_access_denied' using errcode='42501';end if;
 if tg_table_name='finance_cash_period_counts' then
 if not isfinite(new.period_end) or new.period_end>=(clock_timestamp() at time zone 'America/Sao_Paulo')::date then raise exception 'finance_cash_period_not_ended' using errcode='23514';end if;
 if not exists(select 1 from public.bank_accounts where tenant_id=new.tenant_id and id=new.account_id and account_type='cash' and active) then raise exception 'finance_cash_account_required' using errcode='23514';end if;
 if finance_private.cash_count_total(new.counts)<>new.total_cents then raise exception 'finance_cash_count_total_mismatch' using errcode='23514';end if;
 if exists(select 1 from public.finance_cash_period_counts x where x.tenant_id=new.tenant_id and x.account_id=new.account_id and x.period_end=new.period_end and not exists(select 1 from public.finance_cash_period_count_reversals r where r.tenant_id=x.tenant_id and r.count_id=x.id)) then raise exception 'finance_cash_count_already_active' using errcode='23514';end if;
 if finance_private.closed_interval_exists(new.tenant_id,new.account_id,new.period_end,new.period_end) then raise exception 'finance_account_period_closed' using errcode='55000';end if;
 new.revision:=md5((to_jsonb(new)-'revision')::text);
 else
 if not finance_private.can_close_account_period(new.tenant_id) then raise exception 'finance_close_access_denied' using errcode='42501';end if;
 select * into c from public.finance_cash_period_counts where tenant_id=new.tenant_id and id=new.count_id;
 if not found or c.revision is distinct from new.expected_revision then raise exception 'finance_cash_count_changed' using errcode='40001';end if;
 if finance_private.closed_interval_exists(new.tenant_id,c.account_id,c.period_end,c.period_end) or exists(select 1 from public.finance_account_period_dependencies d join public.finance_account_period_closures cl on cl.tenant_id=d.tenant_id and cl.id=d.closure_id where d.tenant_id=new.tenant_id and d.source_kind='finance_cash_period_counts' and d.source_id=c.id and not exists(select 1 from public.finance_account_period_reopenings r where r.tenant_id=cl.tenant_id and r.closure_id=cl.id)) then raise exception 'finance_account_period_closed' using errcode='55000';end if;
 end if;return new;
end$$;
create function finance_private.cash_period_guards_ready() returns boolean language sql stable security definer set search_path='' as $$
select finance_private.account_period_guards_ready() and (select count(*)=2 from pg_catalog.pg_trigger tr join pg_catalog.pg_class c on c.oid=tr.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('finance_cash_period_counts','finance_cash_period_count_reversals') and tr.tgname='finance_cash_count_guard' and tr.tgenabled in('O','A') and tr.tgfoid='finance_private.validate_cash_period_count()'::regprocedure)
$$;
create function finance_private.cash_period_close_snapshot(_tenant uuid,_account uuid,_from date,_to date,_count uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare account public.bank_accounts%rowtype;o public.finance_account_openings%rowtype;pred public.finance_account_period_closures%rowtype;c public.finance_cash_period_counts%rowtype;
 legacy jsonb;facts jsonb;dependencies jsonb;result jsonb;reasons text[]:='{}';initial numeric;inflow numeric;outflow numeric;expected numeric;counted numeric;difference numeric;begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _from is null or _to is null or not isfinite(_from) or not isfinite(_to) or _from>_to or _to-_from>=366 then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 select * into account from public.bank_accounts where tenant_id=_tenant and id=_account;if not found then raise exception 'finance_account_not_found' using errcode='22023';end if;
 if account.account_type is distinct from 'cash' or not account.active then reasons:=array_append(reasons,'cash_account_required');end if;
 if _to>=(clock_timestamp() at time zone 'America/Sao_Paulo')::date then reasons:=array_append(reasons,'period_not_ended');end if;
 select * into o from public.finance_account_openings op where tenant_id=_tenant and bank_account_id=_account and not exists(select 1 from public.finance_account_opening_reversals r where r.tenant_id=_tenant and r.opening_id=op.id);
 if o.id is null or o.evidence_type is distinct from 'cash_count_v1' or not finance_private.cash_opening_evidence_valid(o.evidence,o.effective_from,o.balance_cents) then reasons:=array_append(reasons,'cash_opening_requires_review');end if;
 select * into pred from public.finance_account_period_closures cl where tenant_id=_tenant and account_id=_account and period_end<_from and not exists(select 1 from public.finance_account_period_reopenings r where r.tenant_id=_tenant and r.closure_id=cl.id) order by period_end desc,id limit 1;
 if exists(select 1 from public.finance_account_period_closures cl where tenant_id=_tenant and account_id=_account and period_start<=_to and period_end>=_from and not exists(select 1 from public.finance_account_period_reopenings r where r.tenant_id=_tenant and r.closure_id=cl.id)) then reasons:=array_append(reasons,'period_already_closed');end if;
 if pred.id is null then initial:=o.balance_cents;if o.effective_from is distinct from _from then reasons:=array_append(reasons,'period_must_start_at_opening');end if;
 else initial:=(pred.snapshot#>>'{balances,closing_cents}')::numeric;if pred.period_end+1<>_from or pred.opening_id is distinct from o.id or pred.snapshot->>'evidence_type' is distinct from 'cash_count_v1' then reasons:=array_append(reasons,'predecessor_not_contiguous');end if;end if;
 select * into c from public.finance_cash_period_counts where tenant_id=_tenant and id=_count;
 if c.id is null or c.account_id is distinct from _account or c.period_end is distinct from _to or exists(select 1 from public.finance_cash_period_count_reversals where tenant_id=_tenant and count_id=c.id) then reasons:=array_append(reasons,'cash_count_requires_review');
 elsif c.revision is distinct from md5((to_jsonb(c)-'revision')::text) or finance_private.cash_count_total(c.counts)<>c.total_cents then reasons:=array_append(reasons,'cash_count_integrity_failure');
 else counted:=c.total_cents;end if;
 select coalesce(sum(amount_cents) filter(where direction='in'),0),coalesce(sum(amount_cents) filter(where direction='out'),0) into inflow,outflow from public.finance_movements where tenant_id=_tenant and bank_account_id=_account and occurred_on between _from and _to;
 expected:=initial+inflow-outflow;difference:=counted-expected;
 if difference is null or difference<>0 then reasons:=array_append(reasons,'cash_count_difference');end if;
 if expected<0 then reasons:=array_append(reasons,'cash_negative_position');end if;
 if exists(select 1 from public.finance_bank_entries where tenant_id=_tenant and bank_account_id=_account) or exists(select 1 from public.finance_statement_imports where tenant_id=_tenant and bank_account_id=_account) then reasons:=array_append(reasons,'cash_has_bank_evidence_anomaly');end if;
 legacy:=finance_private.legacy_cut_review_status(_tenant,_account,_from,_to);
 if legacy->'approved' is distinct from 'true'::jsonb or legacy->'current' is distinct from 'true'::jsonb or legacy->'blockers' is distinct from '[]'::jsonb then reasons:=array_append(reasons,'legacy_cut_requires_review');end if;
 if not finance_private.cash_period_guards_ready() then reasons:=array_append(reasons,'closed_period_guards_incomplete');end if;
 facts:=jsonb_build_object('movements',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]') from public.finance_movements m where m.tenant_id=_tenant and m.bank_account_id=_account and m.occurred_on between _from and _to),
 'transfers',(select coalesce(jsonb_agg(to_jsonb(tr) order by tr.id),'[]') from public.finance_internal_transfers tr where tr.tenant_id=_tenant and exists(select 1 from public.finance_movements m where m.tenant_id=_tenant and m.bank_account_id=_account and m.occurred_on between _from and _to and m.id in(tr.outgoing_id,tr.incoming_id))),
 'transfer_departures',(select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]') from public.finance_transfer_departures d where d.tenant_id=_tenant and exists(select 1 from public.finance_movements m where m.tenant_id=_tenant and m.bank_account_id=_account and m.occurred_on between _from and _to and m.id=d.outgoing_id)));
 with sources(kind,role,rows) as(values
 ('finance_movements','money',facts->'movements'),('finance_internal_transfers','composition_snapshot',facts->'transfers'),('finance_transfer_departures','composition_snapshot',facts->'transfer_departures'),
 ('finance_cash_period_counts','cash_evidence',case when c.id is null then '[]'::jsonb else jsonb_build_array(to_jsonb(c)) end),
 ('finance_account_openings','opening',case when o.id is null then '[]'::jsonb else jsonb_build_array(to_jsonb(o)) end),
 ('finance_account_period_closures','predecessor',case when pred.id is null then '[]'::jsonb else jsonb_build_array(to_jsonb(pred)-'snapshot') end),
 ('finance_legacy_cut_reviews','legacy_review',case when legacy->>'review_id' is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('id',legacy->>'review_id','revision',legacy->>'revision')) end)),
 expanded as(select kind,role,row from sources cross join lateral jsonb_array_elements(rows) row)
 select coalesce(jsonb_agg(jsonb_build_object('source_kind',kind,'source_id',row->>'id','source_revision',md5(row::text),'account_id',_account,'affected_from',_from,'affected_to',_to,'dependency_role',role) order by kind,row->>'id'),'[]') into dependencies from expanded;
 result:=jsonb_build_object('version',1,'tenant_id',_tenant,'account_id',_account,'from',_from,'to',_to,'currency','BRL','timezone','America/Sao_Paulo','evidence_type','cash_count_v1','eligible',cardinality(reasons)=0,
 'blockers',(select coalesce(jsonb_agg(jsonb_build_object('code',reason,'source_table',null,'source_ids','[]'::jsonb,'scope','account') order by reason),'[]') from unnest(reasons) reason),
 'opening_id',o.id,'predecessor_id',pred.id,'account',to_jsonb(account),'opening',case when o.id is null then null else to_jsonb(o) end,'predecessor',case when pred.id is null then null else to_jsonb(pred)-'snapshot' end,
 'count',case when c.id is null then null else to_jsonb(c)||jsonb_build_object('total_cents',c.total_cents::text) end,'legacy',legacy,
 'balances',jsonb_build_object('opening_cents',trunc(initial)::text,'in_cents',trunc(inflow)::text,'out_cents',trunc(outflow)::text,'expected_closing_cents',trunc(expected)::text,'counted_closing_cents',trunc(counted)::text,'difference_cents',trunc(difference)::text,'closing_cents',trunc(counted)::text),
 'facts',facts,'dependencies',dependencies);
 return result||jsonb_build_object('revision',md5(result::text));
end$$;
create trigger finance_cash_count_guard before insert on public.finance_cash_period_counts for each row execute function finance_private.validate_cash_period_count();
create trigger finance_cash_count_guard before insert on public.finance_cash_period_count_reversals for each row execute function finance_private.validate_cash_period_count();
create function finance_private.manage_cash_period_count(_payload jsonb,_reverse boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;actor uuid:=auth.uid();actor_name text;account uuid;c public.finance_cash_period_counts%rowtype;prior public.finance_commands%rowtype;action text;result jsonb;reversal uuid;day date;total bigint;begin
 if jsonb_typeof(_payload) is distinct from 'object' or _payload->'version' is distinct from '1'::jsonb or jsonb_typeof(_payload->'reason') is distinct from 'string' or length(btrim(_payload->>'reason')) not between 10 and 2000 or exists(select 1 from jsonb_object_keys(_payload) k where k<>all(case when _reverse then array['version','tenant_id','request_id','count_id','revision','reason'] else array['version','tenant_id','request_id','account_id','period_end','counts','custodian_name','reason','counted_at_boundary'] end)) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;
 if t is null or request is null then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if not finance_private.can_access(t) or (_reverse and not finance_private.can_close_account_period(t)) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if not _reverse and (jsonb_typeof(_payload->'period_end') is distinct from 'string' or coalesce(_payload->>'period_end','') !~ '^\d{4}-\d{2}-\d{2}$' or _payload->>'counted_at_boundary' is distinct from 'end_of_day' or jsonb_typeof(_payload->'custodian_name') is distinct from 'string' or length(btrim(_payload->>'custodian_name')) not between 2 and 200) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if _reverse and coalesce(_payload->>'revision','') !~ '^[0-9a-f]{32}$' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_access(t) or (_reverse and not finance_private.can_close_account_period(t)) then raise exception 'finance_access_denied' using errcode='42501';end if;
 action:=case when _reverse then 'reverse_cash_period_count' else 'record_cash_period_count' end;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;if found then if prior.actor_id<>actor or prior.action<>action or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return prior.result;end if;
 if _reverse then select * into c from public.finance_cash_period_counts where tenant_id=t and id=(_payload->>'count_id')::uuid;if not found then raise exception 'finance_cash_count_not_found' using errcode='22023';end if;account:=c.account_id;else account:=(_payload->>'account_id')::uuid;day:=(_payload->>'period_end')::date;total:=finance_private.cash_count_total(_payload->'counts');end if;
 if account is null then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform 1 from public.bank_accounts where tenant_id=t order by id for update;
 if not finance_private.can_access(t) or (_reverse and not finance_private.can_close_account_period(t)) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into actor_name from auth.users where id=actor;actor_name:=coalesce(actor_name,actor::text);
 if _reverse then
 insert into public.finance_cash_period_count_reversals(tenant_id,count_id,expected_revision,actor_id,actor_name,reason,request_id) values(t,c.id,_payload->>'revision',actor,actor_name,btrim(_payload->>'reason'),request) returning id into reversal;
 else
 insert into public.finance_cash_period_counts(tenant_id,account_id,period_end,counts,total_cents,custodian_name,actor_id,actor_name,reason,request_id,revision) values(t,account,day,_payload->'counts',total,btrim(_payload->>'custodian_name'),actor,actor_name,btrim(_payload->>'reason'),request,'pending') returning * into c;
 end if;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'count_id',c.id,'account_id',c.account_id,'period_end',c.period_end,'counted_cents',c.total_cents::text,'revision',c.revision,'confirmed',true,'cash_created',false);
 if _reverse then result:=result||jsonb_build_object('reversal_id',reversal);end if;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(t,'cash_period_count',c.id,case when _reverse then 'cash_period_count_reversed' else 'cash_period_count_recorded' end,actor,actor_name,btrim(_payload->>'reason'),to_jsonb(c),result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,action,_payload,result);return result;
end$$;
create function finance_private.close_cash_period(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;account uuid;actor uuid:=auth.uid();actor_name text;starts date;ends date;count_id uuid;snapshot jsonb;prior public.finance_commands%rowtype;c public.finance_account_period_closures%rowtype;previous_id uuid;dep jsonb;result jsonb;
begin
 if jsonb_typeof(_payload) is distinct from 'object' or _payload->'version' is distinct from '1'::jsonb or jsonb_typeof(_payload->'reason') is distinct from 'string' or length(btrim(_payload->>'reason')) not between 10 and 2000 or coalesce(_payload->>'revision','') !~ '^[0-9a-f]{32}$' or coalesce(_payload->>'from','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(_payload->>'to','') !~ '^\d{4}-\d{2}-\d{2}$' or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','account_id','from','to','count_id','revision','reason')) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;account:=(_payload->>'account_id')::uuid;starts:=(_payload->>'from')::date;ends:=(_payload->>'to')::date;count_id:=(_payload->>'count_id')::uuid;
 if t is null or request is null or account is null or count_id is null then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if not finance_private.can_close_account_period(t) then raise exception 'finance_close_access_denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_close_account_period(t) then raise exception 'finance_close_access_denied' using errcode='42501';end if;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;if found then if prior.actor_id<>actor or prior.action<>'close_cash_period' or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return prior.result;end if;
 perform 1 from public.bank_accounts where tenant_id=t order by id for update;
 perform 1 from public.finance_cash_period_counts where tenant_id=t and id=count_id for update;
 if not finance_private.can_close_account_period(t) then raise exception 'finance_close_access_denied' using errcode='42501';end if;
 snapshot:=finance_private.cash_period_close_snapshot(t,account,starts,ends,count_id);
 if snapshot->>'revision' is distinct from _payload->>'revision' then raise exception 'finance_period_close_changed' using errcode='40001';end if;
 if snapshot->'eligible' is distinct from 'true'::jsonb or not finance_private.cash_period_guards_ready() then raise exception 'finance_period_close_blocked' using errcode='23514';end if;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into actor_name from auth.users where id=actor;actor_name:=coalesce(actor_name,actor::text);
 select id into previous_id from public.finance_account_period_closures where tenant_id=t and account_id=account and period_start=starts and period_end=ends order by created_at desc,id desc limit 1;
 insert into finance_private.account_close_write_tickets values(txid_current(),t,request,actor,'finance_account_period_closures');
 insert into public.finance_account_period_closures(tenant_id,account_id,period_start,period_end,opening_id,predecessor_id,previous_closure_id,snapshot,snapshot_revision,actor_id,actor_name,reason,request_id) values(t,account,starts,ends,(snapshot->>'opening_id')::uuid,(snapshot->>'predecessor_id')::uuid,previous_id,snapshot,snapshot->>'revision',actor,actor_name,btrim(_payload->>'reason'),request) returning * into c;
 for dep in select value from jsonb_array_elements(snapshot->'dependencies') loop
 insert into public.finance_account_period_dependencies values(t,c.id,dep->>'source_kind',(dep->>'source_id')::uuid,dep->>'source_revision',(dep->>'account_id')::uuid,(dep->>'affected_from')::date,(dep->>'affected_to')::date,dep->>'dependency_role');end loop;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'account_id',account,'closure_id',c.id,'from',starts,'to',ends,'revision',c.snapshot_revision,'confirmed',true,'cash_changed',false);
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(t,'account_period',c.id,'cash_period_closed',actor,actor_name,btrim(_payload->>'reason'),snapshot,result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'close_cash_period',_payload,result);return result;
end$$;
revoke all on function finance_private.validate_cash_period_count(),finance_private.cash_period_guards_ready(),finance_private.cash_period_close_snapshot(uuid,uuid,date,date,uuid),finance_private.manage_cash_period_count(jsonb,boolean),finance_private.close_cash_period(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.cash_period_close_snapshot(uuid,uuid,date,date,uuid),finance_private.manage_cash_period_count(jsonb,boolean),finance_private.close_cash_period(jsonb) to authenticated;
create function public.record_finance_cash_period_count(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.manage_cash_period_count(_payload,false)$$;
create function public.reverse_finance_cash_period_count(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.manage_cash_period_count(_payload,true)$$;
create function public.preview_finance_cash_period_close(_tenant_id uuid,_account_id uuid,_from date,_to date,_count_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.cash_period_close_snapshot(_tenant_id,_account_id,_from,_to,_count_id)||jsonb_build_object('can_execute',finance_private.can_close_account_period(_tenant_id))$$;
create function public.close_finance_cash_period(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.close_cash_period(_payload)$$;
revoke all on function public.record_finance_cash_period_count(jsonb),public.reverse_finance_cash_period_count(jsonb),public.preview_finance_cash_period_close(uuid,uuid,date,date,uuid),public.close_finance_cash_period(jsonb) from public,anon,service_role;
grant execute on function public.record_finance_cash_period_count(jsonb),public.reverse_finance_cash_period_count(jsonb),public.preview_finance_cash_period_close(uuid,uuid,date,date,uuid),public.close_finance_cash_period(jsonb) to authenticated;
