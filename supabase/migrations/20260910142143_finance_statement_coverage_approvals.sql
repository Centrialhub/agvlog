-- User-reviewed completeness is explicitly not bank attestation or period close.
create table public.finance_statement_coverage_approvals(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),bank_account_id uuid not null references public.bank_accounts(id),
 period_start date not null,period_end date not null check(period_end>=period_start),actor_id uuid not null,actor_name text not null,
 reason text not null check(length(btrim(reason)) between 10 and 2000),revision text not null,snapshot jsonb not null,
 declarations jsonb not null check(declarations='{"originals_obtained_from_bank":true,"complete_period_confirmed":true}'::jsonb),
 created_at timestamptz not null default clock_timestamp(),unique(tenant_id,id)
);
create index finance_coverage_period on public.finance_statement_coverage_approvals(tenant_id,bank_account_id,period_start,period_end,created_at,id);
create table public.finance_statement_coverage_reversals(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,approval_id uuid not null,
 actor_id uuid not null,actor_name text not null,reason text not null check(length(btrim(reason)) between 10 and 2000),created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,approval_id),foreign key(tenant_id,approval_id) references public.finance_statement_coverage_approvals(tenant_id,id)
);
do $$declare name text;begin
 foreach name in array array['finance_statement_coverage_approvals','finance_statement_coverage_reversals'] loop
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',name);
  execute format('grant select on public.%I to authenticated',name);
  execute format('create policy finance_coverage_read on public.%I for select to authenticated using(finance_private.can_access(tenant_id))',name);
  execute format('create trigger finance_coverage_immutable before update or delete on public.%I for each row execute function finance_private.preserve_event()',name);
 end loop;
end$$;

create function finance_private.statement_coverage_snapshot(_tenant uuid,_account uuid,_from date,_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare evidence jsonb;dependencies jsonb;reasons text[]:='{}';result jsonb;begin
 evidence:=finance_private.statement_period_evidence(_tenant,_account,_from,_to);
 if _to>=(clock_timestamp() at time zone 'America/Sao_Paulo')::date then reasons:=array_append(reasons,'period_not_finished');end if;
 if not exists(select 1 from public.bank_accounts where tenant_id=_tenant and id=_account and active and account_type in('checking','savings')) then reasons:=array_append(reasons,'bank_account_required');end if;
 if evidence->>'declaration_status'<>'declared_full_days' then reasons:=array_append(reasons,case when evidence->>'declaration_status'='gaps' then 'coverage_gaps' else 'timezone_conflict' end);end if;
 if evidence->>'arithmetic_status'<>'equal' then reasons:=array_append(reasons,case evidence->>'arithmetic_status' when 'missing_anchors' then 'missing_anchors' when 'conflicting_anchors' then 'conflicting_anchors' when 'timezone_conflict' then 'timezone_conflict' else 'balance_mismatch' end);end if;
 if exists(select 1 from jsonb_array_elements(evidence->'anchors') a where a->>'offset_minutes' is distinct from '-180')
  or exists(select 1 from jsonb_array_elements(evidence->'source_evidence') s where s#>>'{native,period,start,offset_minutes}' is distinct from '-180' or s#>>'{native,period,end,offset_minutes}' is distinct from '-180') then reasons:=array_append(reasons,'timezone_not_sao_paulo');end if;
 if exists(select 1 from jsonb_array_elements(evidence->'source_evidence') s where s->>'account_status' is distinct from 'matched_exact') then reasons:=array_append(reasons,'source_account_unverified');end if;
 if exists(select 1 from jsonb_array_elements(evidence->'source_evidence') s where s#>>'{native,outside_declared_period}' is distinct from 'false' or s#>'{native,repeated_bank_ids}' is distinct from '[]'::jsonb) then reasons:=array_append(reasons,'source_integrity_issue');end if;
 with imports as materialized(
  select i.* from public.finance_statement_imports i where i.tenant_id=_tenant and i.bank_account_id=_account
   and (i.period_start<=_to and i.period_end>=_from-1
    or i.id in(select (s->>'import_id')::uuid from jsonb_array_elements(evidence->'source_evidence') s)
    or exists(select 1 from public.finance_bank_entries e where e.tenant_id=_tenant and e.first_import_id=i.id and e.posted_on between _from and _to)
    or exists(select 1 from public.finance_statement_rows r where r.tenant_id=_tenant and r.import_id=i.id and (r.raw->>'posted_on')::date between _from and _to))
 ), rows as materialized(select r.* from public.finance_statement_rows r join imports i on i.tenant_id=r.tenant_id and i.id=r.import_id),
 reviews as materialized(select ir.* from public.finance_statement_identity_reviews ir where ir.tenant_id=_tenant and
  (ir.row_id in(select id from rows) or ir.bank_entry_id in(select id from public.finance_bank_entries where tenant_id=_tenant and bank_account_id=_account and posted_on between _from and _to))),
 verifications as materialized(select v.* from imports i cross join lateral(select * from public.finance_statement_verifications v where v.tenant_id=i.tenant_id and v.import_id=i.id order by v.created_at desc,v.id desc limit 1)v)
 select jsonb_build_object(
  'account',(select jsonb_build_object('id',a.id,'tenant_id',a.tenant_id,'active',a.active,'bank_code',to_jsonb(a)->'bank_code','branch_number',to_jsonb(a)->'branch_number','account_number',to_jsonb(a)->'account_number','account_type',a.account_type) from public.bank_accounts a where a.tenant_id=_tenant and a.id=_account),
  'imports',coalesce((select jsonb_agg(to_jsonb(i)-'source_snapshot' order by i.id) from imports i),'[]'),
  'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from rows r),'[]'),
  'verifications',coalesce((select jsonb_agg(to_jsonb(v) order by v.import_id) from verifications v),'[]'),
  'bank_entries',coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('active',finance_private.bank_entry_active(_tenant,e.id)) order by e.id) from public.finance_bank_entries e where e.tenant_id=_tenant and e.bank_account_id=_account and e.posted_on between _from and _to),'[]'),
  'identity_reviews',coalesce((select jsonb_agg(to_jsonb(ir) order by ir.id) from reviews ir),'[]'),
  'identity_reversals',coalesce((select jsonb_agg(to_jsonb(rv) order by rv.id) from public.finance_statement_review_reversals rv join reviews ir on ir.tenant_id=rv.tenant_id and ir.id=rv.review_id),'[]'),
  'unsupported_sources',(select count(*) from imports where parser_version<>'native-ofx-v1'),
  'unverified_sources',(select count(*) from imports i where not exists(select 1 from verifications v where v.import_id=i.id and v.outcome='rows_match')),
  'unresolved_rows',(select count(*) from rows r where r.classification in('ambiguous','reference_conflict','repeated_reference') and not exists(select 1 from reviews ir where ir.row_id=r.id and not exists(select 1 from public.finance_statement_review_reversals rv where rv.tenant_id=ir.tenant_id and rv.review_id=ir.id)))
 ) into dependencies;
 if (dependencies->>'unsupported_sources')::integer>0 then reasons:=array_append(reasons,'unsupported_source_format');end if;
 if (dependencies->>'unverified_sources')::integer>0 then reasons:=array_append(reasons,'unverified_source');end if;
 if (dependencies->>'unresolved_rows')::integer>0 then reasons:=array_append(reasons,'unresolved_identity');end if;
 select coalesce(array_agg(distinct r order by r),'{}') into reasons from unnest(reasons) r;
 result:=jsonb_build_object('version',1,'tenant_id',_tenant,'account_id',_account,'from',_from,'to',_to,'evidence',evidence,'dependencies',dependencies,
  'blocking_reasons',to_jsonb(reasons),'can_approve',cardinality(reasons)=0,'authenticity_status','not_attested','review_method','reviewed_by_user','can_close',false);
 return result||jsonb_build_object('revision',md5(result::text));
end$$;
revoke all on function finance_private.statement_coverage_snapshot(uuid,uuid,date,date) from public,anon,authenticated,service_role;

create function finance_private.statement_coverage_review(_tenant uuid,_account uuid,_from date,_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare snapshot jsonb;approval public.finance_statement_coverage_approvals%rowtype;history jsonb;current boolean:=false;status text;begin
 snapshot:=finance_private.statement_coverage_snapshot(_tenant,_account,_from,_to);
 select a.* into approval from public.finance_statement_coverage_approvals a where a.tenant_id=_tenant and a.bank_account_id=_account and a.period_start=_from and a.period_end=_to
  and not exists(select 1 from public.finance_statement_coverage_reversals r where r.tenant_id=a.tenant_id and r.approval_id=a.id) order by a.created_at desc,a.id desc limit 1;
 if found then current:=approval.revision=snapshot->>'revision' and (snapshot->>'can_approve')::boolean;status:=case when current then 'approved' else 'needs_review' end;end if;
 select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('reversal',(select to_jsonb(r) from public.finance_statement_coverage_reversals r where r.tenant_id=a.tenant_id and r.approval_id=a.id)) order by a.created_at desc,a.id desc),'[]') into history
  from public.finance_statement_coverage_approvals a where a.tenant_id=_tenant and a.bank_account_id=_account and a.period_start=_from and a.period_end=_to;
 return snapshot||jsonb_build_object('status',coalesce(status,case when jsonb_array_length(history)>0 then 'reversed' else 'not_approved' end),'current',current,'can_approve',(snapshot->>'can_approve')::boolean and approval.id is null,'approval',case when approval.id is null then null else to_jsonb(approval) end,'history',history);
end$$;
revoke all on function finance_private.statement_coverage_review(uuid,uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function finance_private.statement_coverage_review(uuid,uuid,date,date) to authenticated;
create function public.get_finance_statement_coverage_review(_tenant_id uuid,_account_id uuid,_from date,_to date) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.statement_coverage_review(_tenant_id,_account_id,_from,_to)$$;
revoke all on function public.get_finance_statement_coverage_review(uuid,uuid,date,date) from public,anon,service_role;
grant execute on function public.get_finance_statement_coverage_review(uuid,uuid,date,date) to authenticated;

create function finance_private.manage_statement_coverage(_payload jsonb,_reverse boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;actor uuid:=auth.uid();actor_name text;account uuid;starts date;ends date;snapshot jsonb;
 approval uuid;reversal uuid;result jsonb;action text;prior public.finance_commands%rowtype;original public.finance_statement_coverage_approvals%rowtype;begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if request is null or _reverse is null or _payload->'version' is distinct from '1'::jsonb
  or jsonb_typeof(_payload->'reason') is distinct from 'string' or length(btrim(coalesce(_payload->>'reason',''))) not between 10 and 2000
  or exists(select 1 from jsonb_object_keys(_payload) k where k<>all(case when _reverse then array['version','tenant_id','request_id','approval_id','reason'] else array['version','tenant_id','request_id','account_id','from','to','revision','reason','originals_obtained_from_bank','complete_period_confirmed'] end)) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if not _reverse and (_payload->'originals_obtained_from_bank' is distinct from 'true'::jsonb or _payload->'complete_period_confirmed' is distinct from 'true'::jsonb
  or jsonb_typeof(_payload->'revision') is distinct from 'string'
  or jsonb_typeof(_payload->'from') is distinct from 'string' or coalesce(_payload->>'from','') !~ '^\d{4}-\d{2}-\d{2}$'
  or jsonb_typeof(_payload->'to') is distinct from 'string' or coalesce(_payload->>'to','') !~ '^\d{4}-\d{2}-\d{2}$') then raise exception 'finance_invalid_coverage_declaration' using errcode='22023';end if;
 action:=case when _reverse then 'reverse_statement_coverage' else 'approve_statement_coverage' end;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if prior.actor_id<>actor or prior.action<>action or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return prior.result;
 end if;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into actor_name from auth.users where id=actor;actor_name:=coalesce(actor_name,actor::text);
 if _reverse then
  select * into original from public.finance_statement_coverage_approvals where tenant_id=t and id=(_payload->>'approval_id')::uuid;
  if not found then raise exception 'finance_coverage_approval_not_found' using errcode='22023';end if;
  if exists(select 1 from public.finance_statement_coverage_reversals where tenant_id=t and approval_id=original.id) then raise exception 'finance_coverage_already_reversed' using errcode='22023';end if;
  approval:=original.id;
  insert into public.finance_statement_coverage_reversals(tenant_id,approval_id,actor_id,actor_name,reason) values(t,approval,actor,actor_name,btrim(_payload->>'reason')) returning id into reversal;
  result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'approval_id',approval,'reversal_id',reversal,'confirmed',true,'can_close',false);
 else
  account:=(_payload->>'account_id')::uuid;starts:=(_payload->>'from')::date;ends:=(_payload->>'to')::date;
  perform 1 from public.bank_accounts where tenant_id=t and id=account for share;
  if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
  snapshot:=finance_private.statement_coverage_snapshot(t,account,starts,ends);
  if snapshot->>'revision' is distinct from _payload->>'revision' then raise exception 'finance_coverage_evidence_changed' using errcode='40001';end if;
  if not (snapshot->>'can_approve')::boolean then raise exception 'finance_coverage_not_eligible' using errcode='23514',detail=(snapshot->'blocking_reasons')::text;end if;
  if exists(select 1 from public.finance_statement_coverage_approvals a where a.tenant_id=t and a.bank_account_id=account and a.period_start=starts and a.period_end=ends and not exists(select 1 from public.finance_statement_coverage_reversals r where r.tenant_id=t and r.approval_id=a.id)) then raise exception 'finance_coverage_approval_exists' using errcode='23505';end if;
  insert into public.finance_statement_coverage_approvals(tenant_id,bank_account_id,period_start,period_end,actor_id,actor_name,reason,revision,snapshot,declarations)
  values(t,account,starts,ends,actor,actor_name,btrim(_payload->>'reason'),snapshot->>'revision',snapshot,'{"originals_obtained_from_bank":true,"complete_period_confirmed":true}') returning id into approval;
  result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'approval_id',approval,'revision',snapshot->>'revision','review_method','reviewed_by_user','authenticity_status','not_attested','confirmed',true,'can_close',false);
 end if;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(t,'statement_coverage',approval,case when _reverse then 'statement_coverage_reversed' else 'statement_coverage_approved' end,actor,actor_name,btrim(_payload->>'reason'),case when _reverse then to_jsonb(original) end,result||jsonb_build_object('snapshot',snapshot));
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,action,_payload,result);return result;
end$$;
revoke all on function finance_private.manage_statement_coverage(jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function finance_private.manage_statement_coverage(jsonb,boolean) to authenticated;
create function public.record_finance_statement_coverage_approval(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.manage_statement_coverage(_payload,false)$$;
create function public.reverse_finance_statement_coverage_approval(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.manage_statement_coverage(_payload,true)$$;
revoke all on function public.record_finance_statement_coverage_approval(jsonb),public.reverse_finance_statement_coverage_approval(jsonb) from public,anon,service_role;
grant execute on function public.record_finance_statement_coverage_approval(jsonb),public.reverse_finance_statement_coverage_approval(jsonb) to authenticated;
do $$declare body text;needle text:='''identity_reviewed_manually'',''identity_review_reversed''';begin
 select pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure) into body;
 if position(needle in body)=0 then raise exception 'finance_coverage_audit_contract_changed';end if;
 execute replace(body,needle,'''statement_coverage_approved'',''statement_coverage_reversed'','||needle);
end$$;
