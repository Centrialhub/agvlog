-- Native file declarations and balance arithmetic are evidence, not proof of
-- authenticity, completeness, internal reconciliation or a frozen close.
create function finance_private.statement_period_evidence(_tenant uuid,_account uuid,_from date,_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _from is null or _to is null or _to<_from or _to-_from>3660 then raise exception 'finance_invalid_period' using errcode='22023';end if;
 if not exists(select 1 from public.bank_accounts where tenant_id=_tenant and id=_account) then raise exception 'finance_account_not_found' using errcode='22023';end if;
 with sources as materialized(
  select i.id,i.file_name,i.file_hash,v.id verification_id,v.report->'native_evidence' native,
   finance_private.native_statement_account(_tenant,i.id)->>'status' account_status
  from public.finance_statement_imports i
  left join lateral(select * from public.finance_statement_verifications v where v.tenant_id=i.tenant_id and v.import_id=i.id order by v.created_at desc,v.id desc limit 1)v on true
  where i.tenant_id=_tenant and i.bank_account_id=_account and i.parser_version='native-ofx-v1'
   and (i.period_start<=_to and i.period_end>=_from-1 or v.report#>>'{native_evidence,ledger_balance,as_of,date}' in((_from-1)::text,_to::text))
 ), qualified as materialized(
  select * from sources where account_status='matched_exact' and native->>'outside_declared_period'='false'
   and native->'repeated_bank_ids'='[]'::jsonb
 ), intervals as materialized(
  select *, (native#>>'{period,start,date}')::date starts,(native#>>'{period,end,date}')::date ends,
   (native#>>'{period,start,offset_minutes}')::integer tz
  from qualified where native#>>'{period,start,raw}'~'^\d{8}000000\[[+-]?\d{1,2}(:[A-Za-z0-9_+-]+)?\]$'
   and native#>>'{period,end,raw}'~'^\d{8}235959\[[+-]?\d{1,2}(:[A-Za-z0-9_+-]+)?\]$'
   and native#>>'{period,start,offset_minutes}'=native#>>'{period,end,offset_minutes}'
 ), anchors as materialized(
  select id,verification_id,file_name,file_hash,(native#>>'{ledger_balance,as_of,date}')::date anchor_day,
   (native#>>'{ledger_balance,amount_cents}')::bigint cents,(native#>>'{ledger_balance,as_of,offset_minutes}')::integer tz
  from qualified where native#>>'{ledger_balance,as_of,raw}'~'^\d{8}235959\[[+-]?\d{1,2}(:[A-Za-z0-9_+-]+)?\]$'
   and native#>>'{ledger_balance,amount_cents}'~'^-?\d{1,14}$'
   and (native#>>'{ledger_balance,as_of,date}')::date in(_from-1,_to)
 ), balance_values as(
  select count(distinct (cents,tz)) filter(where anchor_day=_from-1) opening_variants,
   count(distinct (cents,tz)) filter(where anchor_day=_to) closing_variants,
   min(cents) filter(where anchor_day=_from-1) opening,min(cents) filter(where anchor_day=_to) closing,
   min(tz) filter(where anchor_day=_from-1) opening_tz,min(tz) filter(where anchor_day=_to) closing_tz from anchors
 ), days as(select _from+n anchor_day from generate_series(0,_to-_from)n),
 coverage as(select count(*) filter(where not exists(select 1 from intervals i where d.anchor_day between i.starts and i.ends)) missing_days,
  count(distinct i.tz) timezones from days d left join intervals i on d.anchor_day between i.starts and i.ends),
 net as(select coalesce(sum(amount_cents),0) cents from public.finance_bank_entries e
  where e.tenant_id=_tenant and e.bank_account_id=_account and e.posted_on between _from and _to and finance_private.bank_entry_active(_tenant,e.id))
 select jsonb_build_object('version',1,'tenant_id',_tenant,'account_id',_account,'from',_from,'to',_to,
  'native_source_count',(select count(*) from sources),'qualified_source_count',(select count(*) from qualified),
  'source_evidence',coalesce((select jsonb_agg(jsonb_build_object('import_id',id,'verification_id',verification_id,'file_hash',file_hash,'account_status',account_status,'native',native) order by id) from sources),'[]'),
  'missing_declared_days',c.missing_days,'timezone_count',c.timezones,
  'declaration_status',case when c.missing_days>0 then 'gaps' when c.timezones<>1 then 'timezone_conflict' else 'declared_full_days' end,
  'opening_balance_cents',case when b.opening_variants=1 then b.opening::text end,
  'closing_balance_cents',case when b.closing_variants=1 then b.closing::text end,
  'bank_net_cents',n.cents::text,
  'arithmetic_status',case when b.opening_variants>1 or b.closing_variants>1 then 'conflicting_anchors'
   when b.opening_variants=0 or b.closing_variants=0 then 'missing_anchors'
   when b.opening_tz<>b.closing_tz or exists(select 1 from intervals where starts<=_to and ends>=_from and tz<>b.opening_tz) then 'timezone_conflict'
   when b.opening+n.cents=b.closing then 'equal' else 'different' end,
  'difference_cents',case when b.opening_variants=1 and b.closing_variants=1 and b.opening_tz=b.closing_tz then (b.opening+n.cents-b.closing)::text end,
  'anchors',coalesce((select jsonb_agg(jsonb_build_object('import_id',id,'verification_id',verification_id,'file_name',file_name,'file_hash',file_hash,'day',anchor_day,'cents',cents::text,'offset_minutes',tz) order by anchor_day,id) from anchors),'[]'),
  'coverage_status','requires_review','authenticity_status','not_attested','legacy_integration_status','pending','can_close',false)
 into result from balance_values b cross join coverage c cross join net n;
 return result||jsonb_build_object('revision',md5(result::text));
end;$$;
revoke all on function finance_private.statement_period_evidence(uuid,uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function finance_private.statement_period_evidence(uuid,uuid,date,date) to authenticated;
create function public.get_finance_statement_period_evidence(_tenant_id uuid,_account_id uuid,_from date,_to date) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.statement_period_evidence(_tenant_id,_account_id,_from,_to)$$;
revoke all on function public.get_finance_statement_period_evidence(uuid,uuid,date,date) from public,anon,service_role;
grant execute on function public.get_finance_statement_period_evidence(uuid,uuid,date,date) to authenticated;

create table public.finance_period_evidence_reviews(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 bank_account_id uuid not null references public.bank_accounts(id),period_start date not null,period_end date not null,
 actor_id uuid not null,reason text not null,snapshot jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index finance_period_evidence_review_period on public.finance_period_evidence_reviews(tenant_id,bank_account_id,period_start,period_end,created_at,id);
alter table public.finance_period_evidence_reviews enable row level security;
revoke all on public.finance_period_evidence_reviews from public,anon,authenticated,service_role;
grant select on public.finance_period_evidence_reviews to authenticated;
create policy finance_period_evidence_reviews_read on public.finance_period_evidence_reviews for select to authenticated using(finance_private.can_access(tenant_id));
create trigger finance_period_evidence_reviews_immutable before update or delete on public.finance_period_evidence_reviews for each row execute function finance_private.preserve_event();
create function finance_private.record_period_evidence_review(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;actor uuid;actor_name text;request uuid;account uuid;starts date;ends date;snapshot jsonb;prior public.finance_commands%rowtype;review uuid;result jsonb;begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;actor:=auth.uid();
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 request:=(_payload->>'request_id')::uuid;account:=(_payload->>'account_id')::uuid;starts:=(_payload->>'from')::date;ends:=(_payload->>'to')::date;
 if request is null or _payload->>'version' is distinct from '1' or length(btrim(coalesce(_payload->>'reason','')))<5 or length(_payload->>'reason')>1000
  or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','account_id','from','to','revision','reason')) then raise exception 'finance_invalid_review' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if prior.actor_id<>actor or prior.action<>'review_period_evidence' or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;
  return prior.result;
 end if;
 snapshot:=finance_private.statement_period_evidence(t,account,starts,ends);
 if snapshot->>'revision' is distinct from _payload->>'revision' then raise exception 'finance_period_evidence_changed' using errcode='40001';end if;
 insert into public.finance_period_evidence_reviews(tenant_id,bank_account_id,period_start,period_end,actor_id,reason,snapshot)
 values(t,account,starts,ends,actor,btrim(_payload->>'reason'),snapshot) returning id into review;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'review_id',review,'confirmed',true,'can_close',false);
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into actor_name from auth.users where id=actor;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data)
 values(t,'period_evidence',review,'period_evidence_reviewed',actor,coalesce(actor_name,actor::text),btrim(_payload->>'reason'),snapshot);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'review_period_evidence',_payload,result);
 return result;
end;$$;
revoke all on function finance_private.record_period_evidence_review(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.record_period_evidence_review(jsonb) to authenticated;
create function public.record_finance_period_evidence_review(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.record_period_evidence_review(_payload)$$;
revoke all on function public.record_finance_period_evidence_review(jsonb) from public,anon,service_role;
grant execute on function public.record_finance_period_evidence_review(jsonb) to authenticated;

do $$declare body text;needle text:='''identity_reviewed_manually'',''identity_review_reversed''';begin
 select pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure) into body;
 if position(needle in body)=0 then raise exception 'finance_period_evidence_audit_contract_changed';end if;
 execute replace(body,needle,'''period_evidence_reviewed'','||needle);
end$$;
