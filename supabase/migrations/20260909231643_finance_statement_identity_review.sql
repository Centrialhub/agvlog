-- Manual identity decisions preserve the original classification and never settle money.
alter table public.finance_statement_rows add constraint finance_statement_rows_tenant_identity unique(tenant_id,id);
create table public.finance_statement_identity_reviews(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,row_id uuid not null,
 decision text not null check(decision in('same_transaction','distinct_transaction')),
 bank_entry_id uuid not null,source_verification_id uuid not null references public.finance_statement_verifications(id),
 actor_id uuid not null,actor_name text not null,reason text not null check(length(btrim(reason)) between 10 and 2000),
 created_at timestamptz not null default clock_timestamp(),unique(tenant_id,id),
 foreign key(tenant_id,row_id) references public.finance_statement_rows(tenant_id,id),
 foreign key(tenant_id,bank_entry_id) references public.finance_bank_entries(tenant_id,id)
);
alter table public.finance_statement_identity_reviews enable row level security;
revoke all on public.finance_statement_identity_reviews from public,anon,authenticated,service_role;
grant select on public.finance_statement_identity_reviews to authenticated,service_role;
create policy finance_identity_reviews_read on public.finance_statement_identity_reviews for select to authenticated using(finance_private.can_access(tenant_id));
create trigger finance_identity_reviews_immutable before update or delete on public.finance_statement_identity_reviews for each row execute function finance_private.preserve_event();

create table public.finance_statement_review_reversals(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,review_id uuid not null,
 actor_id uuid not null,actor_name text not null,reason text not null check(length(btrim(reason)) between 10 and 2000),
 created_at timestamptz not null default clock_timestamp(),unique(tenant_id,review_id),
 foreign key(tenant_id,review_id) references public.finance_statement_identity_reviews(tenant_id,id)
);
alter table public.finance_statement_review_reversals enable row level security;
revoke all on public.finance_statement_review_reversals from public,anon,authenticated,service_role;
grant select on public.finance_statement_review_reversals to authenticated,service_role;
create policy finance_review_reversals_read on public.finance_statement_review_reversals for select to authenticated using(finance_private.can_access(tenant_id));
create trigger finance_review_reversals_immutable before update or delete on public.finance_statement_review_reversals for each row execute function finance_private.preserve_event();
create index finance_identity_reviews_row on public.finance_statement_identity_reviews(tenant_id,row_id,created_at,id);
create or replace function finance_private.bank_entry_active(_tenant uuid,_entry uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.finance_bank_entries e where e.tenant_id=_tenant and e.id=_entry and (
   not exists(select 1 from public.finance_statement_identity_reviews ir where ir.tenant_id=_tenant and ir.bank_entry_id=e.id and ir.decision='distinct_transaction')
   or exists(select 1 from public.finance_statement_identity_reviews ir where ir.tenant_id=_tenant and ir.bank_entry_id=e.id and ir.decision='distinct_transaction'
     and not exists(select 1 from public.finance_statement_review_reversals rv where rv.tenant_id=_tenant and rv.review_id=ir.id))));
$$;

create function finance_private.review_statement_identity(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;actor uuid:=auth.uid();row_id uuid;target uuid;decision text;reason text;
 r public.finance_statement_rows%rowtype;i public.finance_statement_imports%rowtype;e public.finance_bank_entries%rowtype;
 v public.finance_statement_verifications%rowtype;existing public.finance_commands%rowtype;
 review_id uuid;actor_name text;result jsonb;previous_review uuid;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;row_id:=(_payload->>'row_id')::uuid;
 target:=(_payload->>'bank_entry_id')::uuid;decision:=_payload->>'decision';reason:=btrim(_payload->>'reason');
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if request is null or row_id is null or _payload->>'version' is distinct from '1'
   or coalesce(decision,'') not in('same_transaction','distinct_transaction') or length(coalesce(reason,'')) not between 10 and 2000
   or (decision='same_transaction' and target is null) or (decision='distinct_transaction' and target is not null)
   or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','row_id','bank_entry_id','decision','reason','source_verification_id','previous_review_id')) then
   raise exception 'finance_invalid_identity_review' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 select * into existing from public.finance_commands where tenant_id=t and request_id=request;
 if found then
   if existing.actor_id<>actor or existing.action<>'review_statement_identity' or existing.payload<>_payload then
     raise exception 'finance_request_conflict' using errcode='23505';end if;return existing.result;
 end if;
 select * into r from public.finance_statement_rows sr where sr.tenant_id=t and sr.id=row_id;
 if not found then raise exception 'finance_statement_row_not_found' using errcode='22023';end if;
 if r.classification not in('ambiguous','reference_conflict','repeated_reference') or r.bank_entry_id is not null then
   raise exception 'finance_statement_row_not_pending' using errcode='22023';end if;
 if exists(select 1 from public.finance_statement_identity_reviews ir where ir.tenant_id=t and ir.row_id=r.id
   and not exists(select 1 from public.finance_statement_review_reversals rv where rv.tenant_id=t and rv.review_id=ir.id)) then
   raise exception 'finance_statement_row_already_reviewed' using errcode='40001';end if;
 select pr.id into previous_review from public.finance_statement_identity_reviews pr where pr.tenant_id=t and pr.row_id=r.id order by pr.created_at desc,pr.id desc limit 1;
 if previous_review is distinct from (_payload->>'previous_review_id')::uuid then raise exception 'finance_identity_review_changed' using errcode='40001';end if;
 select * into i from public.finance_statement_imports where tenant_id=t and id=r.import_id;
 select * into v from public.finance_statement_verifications where tenant_id=t and import_id=i.id order by created_at desc,id desc limit 1;
 if v.id is null or v.outcome<>'rows_match' or v.id is distinct from (_payload->>'source_verification_id')::uuid then
   raise exception 'finance_statement_source_review_required' using errcode='40001';end if;
 if decision='same_transaction' then
   select * into e from public.finance_bank_entries where tenant_id=t and id=target;
   if not found or not finance_private.bank_entry_active(t,e.id) or e.bank_account_id<>i.bank_account_id or e.currency<>i.currency or e.posted_on<>(r.raw->>'posted_on')::date
     or e.amount_cents<>(r.raw->>'amount_cents')::bigint
     or (nullif(r.raw->>'counterparty_document','') is not null and e.counterparty_document is not null and r.raw->>'counterparty_document'<>e.counterparty_document) then
     raise exception 'finance_identity_target_conflict' using errcode='22023';end if;
   -- The target's original must also be independently verified; a second unverified file cannot serve as proof.
   if coalesce((select outcome from public.finance_statement_verifications where tenant_id=t and import_id=e.first_import_id order by created_at desc,id desc limit 1),'pending')<>'rows_match' then
     raise exception 'finance_identity_target_unverified' using errcode='22023';end if;
 else
   -- A disputed/reused native reference is retained in raw evidence, never promoted to a trusted unique ID.
   select id into target from public.finance_bank_entries where tenant_id=t and first_import_id=i.id and source_row=r.source_row;
   if target is null then
   insert into public.finance_bank_entries(tenant_id,bank_account_id,first_import_id,source_row,posted_on,amount_cents,currency,
     bank_id,description,document_number,counterparty_document,counterparty_name,raw)
   values(t,i.bank_account_id,i.id,r.source_row,(r.raw->>'posted_on')::date,(r.raw->>'amount_cents')::bigint,i.currency,
     null,coalesce(r.raw->>'description',''),nullif(r.raw->>'document_number',''),nullif(r.raw->>'counterparty_document',''),
     nullif(r.raw->>'counterparty_name',''),r.raw->'raw') returning id into target;
   end if;
 end if;
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into actor_name from auth.users where id=actor;
 insert into public.finance_statement_identity_reviews(tenant_id,row_id,decision,bank_entry_id,source_verification_id,actor_id,actor_name,reason)
 values(t,r.id,decision,target,v.id,actor,coalesce(actor_name,actor::text),reason) returning id into review_id;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'review_id',review_id,'row_id',r.id,'import_id',i.id,
   'decision',decision,'bank_entry_id',target,'manual',true,'confirmed',true,'reconciliation_status','pending');
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(t,'statement_import',i.id,'identity_reviewed_manually',actor,coalesce(actor_name,actor::text),reason,to_jsonb(r),result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'review_statement_identity',_payload,result);
 return result;
end;$$;
revoke all on function finance_private.review_statement_identity(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.review_statement_identity(jsonb) to authenticated;
create function public.review_finance_statement_identity(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.review_statement_identity(_payload);$$;
revoke all on function public.review_finance_statement_identity(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.review_finance_statement_identity(jsonb) to authenticated;

alter function finance_private.list_statements(uuid,jsonb) rename to list_statements_original;
revoke all on function finance_private.list_statements_original(uuid,jsonb) from authenticated;
create function finance_private.list_statements(_tenant uuid,_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$declare result jsonb;begin
 result:=finance_private.list_statements_original(_tenant,_filters);
 return jsonb_set(result,'{rows}',coalesce((select jsonb_agg(item||jsonb_build_object(
   'manual_review_count',(select count(*) from public.finance_statement_identity_reviews ir join public.finance_statement_rows sr on sr.id=ir.row_id and sr.tenant_id=ir.tenant_id where ir.tenant_id=_tenant and sr.import_id=(item->>'id')::uuid),
   'identity_review_count',(select count(*) from public.finance_statement_rows sr where sr.tenant_id=_tenant and sr.import_id=(item->>'id')::uuid and sr.classification in('ambiguous','reference_conflict','repeated_reference')
     and not exists(select 1 from public.finance_statement_identity_reviews ir where ir.tenant_id=_tenant and ir.row_id=sr.id
       and not exists(select 1 from public.finance_statement_review_reversals rv where rv.tenant_id=_tenant and rv.review_id=ir.id))))) from jsonb_array_elements(result->'rows') item),'[]'));
end;$$;
revoke all on function finance_private.list_statements(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.list_statements(uuid,jsonb) to authenticated;
alter function finance_private.statement_lines(uuid,uuid,jsonb) rename to statement_lines_original;
revoke all on function finance_private.statement_lines_original(uuid,uuid,jsonb) from authenticated;
create function finance_private.statement_lines(_tenant uuid,_import uuid,_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$declare result jsonb;begin
 result:=finance_private.statement_lines_original(_tenant,_import,_filters);
 result:=result||jsonb_build_object('source_verification_id',(select id from public.finance_statement_verifications where tenant_id=_tenant and import_id=_import order by created_at desc,id desc limit 1));
 return jsonb_set(result,'{rows}',coalesce((select jsonb_agg(item||jsonb_build_object('manual_review',
   (select to_jsonb(ir)||jsonb_build_object('reversal',(select to_jsonb(rv) from public.finance_statement_review_reversals rv where rv.tenant_id=_tenant and rv.review_id=ir.id))
     from public.finance_statement_identity_reviews ir where ir.tenant_id=_tenant and ir.row_id=(item->>'id')::uuid order by ir.created_at desc,ir.id desc limit 1))) from jsonb_array_elements(result->'rows') item),'[]'));
end;$$;
revoke all on function finance_private.statement_lines(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.statement_lines(uuid,uuid,jsonb) to authenticated;

create function finance_private.identity_candidates(_tenant uuid,_row uuid,_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare r public.finance_statement_rows%rowtype;account uuid;result jsonb;begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page not between 1 and 1000000 then raise exception 'finance_invalid_statement_filters' using errcode='22023';end if;
 select * into r from public.finance_statement_rows where tenant_id=_tenant and id=_row;
 if not found then raise exception 'finance_statement_row_not_found' using errcode='22023';end if;
 select bank_account_id into account from public.finance_statement_imports where tenant_id=_tenant and id=r.import_id;
 with matches as materialized(select e.id,e.posted_on,e.amount_cents,e.description,e.bank_id,e.counterparty_name,e.first_import_id
   from public.finance_bank_entries e where e.tenant_id=_tenant and e.bank_account_id=account and e.posted_on=(r.raw->>'posted_on')::date and e.amount_cents=(r.raw->>'amount_cents')::bigint
     and not(e.first_import_id=r.import_id and e.source_row=r.source_row) and finance_private.bank_entry_active(_tenant,e.id)
     and (nullif(r.raw->>'counterparty_document','') is null or e.counterparty_document is null or e.counterparty_document=r.raw->>'counterparty_document')),
 paged as(select * from matches order by id limit 30 offset (_page-1)*30)
 select jsonb_build_object('tenant_id',_tenant,'row_id',_row,'page',_page,'total',(select count(*) from matches),
   'rows',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('file_name',i.file_name,'source_verified',coalesce(v.outcome='rows_match',false)) order by p.id)
     from paged p join public.finance_statement_imports i on i.id=p.first_import_id and i.tenant_id=_tenant
     left join lateral(select outcome from public.finance_statement_verifications where tenant_id=_tenant and import_id=p.first_import_id order by created_at desc,id desc limit 1) v on true),'[]')) into result;
 return result;
end;$$;
revoke all on function finance_private.identity_candidates(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function finance_private.identity_candidates(uuid,uuid,integer) to authenticated;
create function public.list_finance_identity_candidates(_tenant_id uuid,_row_id uuid,_page integer default 1) returns jsonb language sql security invoker set search_path='' as $$select finance_private.identity_candidates(_tenant_id,_row_id,_page);$$;
revoke all on function public.list_finance_identity_candidates(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_finance_identity_candidates(uuid,uuid,integer) to authenticated;

create function finance_private.reverse_identity_review(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;review uuid;actor uuid:=auth.uid();actor_name text;reason text;v_import uuid;
 ir public.finance_statement_identity_reviews%rowtype;existing public.finance_commands%rowtype;result jsonb;reversal uuid;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;review:=(_payload->>'review_id')::uuid;reason:=btrim(_payload->>'reason');
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if request is null or review is null or _payload->>'version' is distinct from '1' or length(coalesce(reason,'')) not between 10 and 2000
   or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','review_id','reason')) then
   raise exception 'finance_invalid_review_reversal' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 select * into existing from public.finance_commands where tenant_id=t and request_id=request;
 if found then
   if existing.actor_id<>actor or existing.action<>'reverse_identity_review' or existing.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;
   return existing.result;
 end if;
 select * into ir from public.finance_statement_identity_reviews where tenant_id=t and id=review;
 if not found then raise exception 'finance_identity_review_not_found' using errcode='22023';end if;
 if exists(select 1 from public.finance_statement_review_reversals where tenant_id=t and review_id=review) then
   raise exception 'finance_identity_review_already_reversed' using errcode='40001';end if;
 if ir.decision='distinct_transaction' and (
   exists(select 1 from public.finance_statement_identity_reviews dep where dep.tenant_id=t and dep.bank_entry_id=ir.bank_entry_id and dep.id<>ir.id
     and not exists(select 1 from public.finance_statement_review_reversals rv where rv.tenant_id=t and rv.review_id=dep.id))
   or exists(select 1 from public.finance_statement_rows sr where sr.tenant_id=t and sr.bank_entry_id=ir.bank_entry_id)) then
   raise exception 'finance_identity_review_has_dependents' using errcode='23514';end if;
 select import_id into v_import from public.finance_statement_rows where tenant_id=t and id=ir.row_id;
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into actor_name from auth.users where id=actor;
 insert into public.finance_statement_review_reversals(tenant_id,review_id,actor_id,actor_name,reason)
 values(t,review,actor,coalesce(actor_name,actor::text),reason) returning id into reversal;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'review_id',review,'reversal_id',reversal,'row_id',ir.row_id,'import_id',v_import,'confirmed',true,'manual',true);
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(t,'statement_import',v_import,'identity_review_reversed',actor,coalesce(actor_name,actor::text),reason,to_jsonb(ir),result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'reverse_identity_review',_payload,result);
 return result;
end;$$;
revoke all on function finance_private.reverse_identity_review(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.reverse_identity_review(jsonb) to authenticated;
create function public.reverse_finance_identity_review(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.reverse_identity_review(_payload);$$;
revoke all on function public.reverse_finance_identity_review(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.reverse_finance_identity_review(jsonb) to authenticated;
