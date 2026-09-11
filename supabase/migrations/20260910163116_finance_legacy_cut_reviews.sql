-- Complete raw source manifest; review changes no money and is not bank authenticity.
create table public.finance_legacy_cut_reviews(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),bank_account_id uuid not null,
 period_start date not null,period_end date not null check(period_end>=period_start),revision text not null,snapshot jsonb not null,
 actor_id uuid not null,actor_name text not null,reason text not null check(length(btrim(reason)) between 10 and 2000),created_at timestamptz not null default clock_timestamp()
);
alter table public.finance_legacy_cut_reviews enable row level security;
revoke all on public.finance_legacy_cut_reviews from public,anon,authenticated,service_role;
create trigger preserve_legacy_cut_review before update or delete on public.finance_legacy_cut_reviews for each row execute function finance_private.preserve_event();
create function finance_private.can_review_legacy_cut(_tenant uuid) returns boolean language sql stable security definer set search_path='' as $$
 select finance_private.can_access(_tenant) and exists(select 1 from public.tenant_memberships where tenant_id=_tenant and user_id=auth.uid() and active and role::text in('owner','admin'))
$$;
revoke all on function finance_private.can_review_legacy_cut(uuid) from public,anon,authenticated,service_role;

create function finance_private.legacy_cut_manifest(_tenant uuid,_account uuid,_from date,_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare sources jsonb:='[]';evidence jsonb:='{}';blockers jsonb:='[]';rows_json jsonb;item jsonb;entry jsonb;integrity jsonb;r record;
 classification text;table_name text;resolved jsonb;new_sources jsonb:='[]';day date;account uuid;amount numeric;movement_ids jsonb;m record;valid boolean;manifest jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _from is null or _to is null or not isfinite(_from) or not isfinite(_to) or _from>_to or _to-_from>365 then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 if not exists(select 1 from public.bank_accounts where tenant_id=_tenant and id=_account) then raise exception 'finance_account_not_found' using errcode='22023';end if;
 -- Every included family is explicit, including zero counts. No page or LIMIT.
 foreach table_name in array array['receivables_payments','receivable_payment_reversals','payables_payments','driver_settlement_payments','closing_report_payments','load_payments','employee_advances','payroll_entry_items','bank_transactions','finance_movements','finance_receivable_movement_links','finance_payable_movement_links','finance_payable_link_reversals','finance_settlement_movement_links','finance_settlement_link_reversals','finance_legacy_receipt_movement_links','finance_legacy_receipt_link_reversals','finance_receipt_allocation_corrections'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]'') from public.%I x where tenant_id=$1',table_name) into rows_json using _tenant;
  evidence:=evidence||jsonb_build_object(table_name,rows_json);
 end loop;
 select coalesce(jsonb_agg(to_jsonb(x) order by source_table,source_id),'[]') into integrity from finance_private.legacy_integrity_rows(_tenant) x;
 foreach table_name in array array['receivables_payments','receivable_payment_reversals','payables_payments','driver_settlement_payments','closing_report_payments','load_payments','employee_advances','payroll_entry_items','bank_transactions'] loop
  for item in select value from jsonb_array_elements(evidence->table_name) loop
   if table_name='employee_advances' and item->>'status' is distinct from 'paid' then continue;end if;
   if table_name='payroll_entry_items' and item->>'nature' is distinct from 'already_paid' then continue;end if;
   day:=case table_name when 'receivables_payments' then ((item->>'received_at')::timestamptz at time zone 'America/Sao_Paulo')::date when 'receivable_payment_reversals' then ((item->>'effective_at')::timestamptz at time zone 'America/Sao_Paulo')::date when 'bank_transactions' then ((item->>'posted_at')::timestamptz at time zone 'America/Sao_Paulo')::date when 'closing_report_payments' then (item->>'payment_date')::date when 'load_payments' then (item->>'payment_date')::date when 'payroll_entry_items' then coalesce(((item->>'occurred_at')::timestamptz at time zone 'America/Sao_Paulo')::date,(item->>'competence_date')::date) else coalesce(((item->>'paid_at')::timestamptz at time zone 'America/Sao_Paulo')::date,(item->>'advance_date')::date) end;
   account:=(item->>'bank_account_id')::uuid;amount:=(item->>'amount')::numeric*100;movement_ids:='[]';
   -- Refund money belongs to its own exact bank leg, never the incoming parent account.
   if table_name='receivable_payment_reversals' then select bank_account_id into account from public.bank_transactions where tenant_id=_tenant and id=(item->>'bank_transaction_id')::uuid;end if;
   if account is not null and exists(select 1 from public.bank_accounts where tenant_id=_tenant and id=account) and account<>_account then continue;end if;
   if day is not null and isfinite(day) and (day<_from or day>_to) then continue;end if;
   valid:=false;classification:='requires_resolution';
   if table_name in('receivables_payments','payables_payments','receivable_payment_reversals') and amount>0 and amount=trunc(amount) and amount<=99999999999999 and day is not null and isfinite(day) then
    for m in
     select value link from jsonb_array_elements(case table_name when 'payables_payments' then evidence->'finance_payable_movement_links' else evidence->'finance_receivable_movement_links' end)
     where value->>'payment_id'=case when table_name='receivable_payment_reversals' then item->>'payment_id' else item->>'id' end
     and (table_name='payables_payments' or value->>'action'=case when table_name='receivable_payment_reversals' then 'reverse' else 'receive' end)
     and (table_name<>'payables_payments' or value->>'payable_id'=item->>'payable_id')
     and (table_name='payables_payments' or (value->>'command_id'=item->>'financial_command_id' and value->>'bank_transaction_id'=item->>'bank_transaction_id'))
    loop
     select * into r from public.finance_movements where tenant_id=_tenant and id=(m.link->>'movement_id')::uuid;
     if found and r.bank_account_id=account and r.occurred_on=day and r.direction=(case when table_name='receivables_payments' then 'in' else 'out' end) and r.amount_cents>=amount
       and (table_name<>'payables_payments' or ((m.link->>'amount_cents')::numeric=amount and (coalesce(m.link->>'origin','canonical')='canonical' or not exists(select 1 from public.finance_payable_link_reversals where tenant_id=_tenant and link_id=(m.link->>'id')::uuid)))) then movement_ids:=movement_ids||jsonb_build_array(r.id);end if;
    end loop;
    if table_name='receivables_payments' then
     for m in select value link from jsonb_array_elements(evidence->'finance_legacy_receipt_movement_links') where value->>'payment_id'=item->>'id' and (value->>'amount_cents')::numeric=amount and value->>'receivable_id'=item->>'receivable_id' and not exists(select 1 from public.finance_legacy_receipt_link_reversals where tenant_id=_tenant and link_id=(value->>'id')::uuid) loop
      select * into r from public.finance_movements where tenant_id=_tenant and id=(m.link->>'movement_id')::uuid;
      if found and r.bank_account_id=account and r.occurred_on=day and r.direction='in' and r.amount_cents>=amount then movement_ids:=movement_ids||jsonb_build_array(r.id);end if;
     end loop;
    end if;
    valid:=jsonb_array_length(movement_ids)=1;
   end if;
   if valid then
    classification:='exact_canonical_mapping';
    if table_name='receivables_payments' and exists(select 1 from public.finance_receipt_allocation_corrections c where c.tenant_id=_tenant and c.payment_id=(item->>'id')::uuid and c.receivable_id=(item->>'receivable_id')::uuid and c.movement_id=(movement_ids->>0)::uuid) then classification:='corrected_receipt_projection';end if;
    if table_name='payables_payments' and exists(select 1 from jsonb_array_elements(evidence->'finance_payable_movement_links') l join public.finance_payable_link_reversals rv on rv.tenant_id=_tenant and rv.link_id=(l->>'id')::uuid where l->>'payment_id'=item->>'id' and coalesce(l->>'origin','canonical')='canonical') then classification:='reversed_canonical_payment_projection';end if;
   end if;
   entry:=jsonb_build_object('source_table',table_name,'source_id',item->>'id','occurred_on',case when isfinite(day) then day end,'account_id',account,'amount_cents',case when amount>0 and amount=trunc(amount) and amount<=99999999999999 then trunc(amount)::text end,'movement_ids',movement_ids,'classification',classification);
   if exists(select 1 from jsonb_array_elements(integrity) x where x->>'source_table'=table_name and x->>'source_id'=item->>'id') then valid:=false;entry:=entry||jsonb_build_object('classification','integrity_failure');end if;
   sources:=sources||jsonb_build_array(entry);
   if not valid then blockers:=blockers||jsonb_build_array(jsonb_build_object('code',case when day is null or not isfinite(day) then 'legacy_source_date_unknown' when account is null or not exists(select 1 from public.bank_accounts where tenant_id=_tenant and id=account) then 'legacy_source_account_unknown' else 'legacy_source_requires_resolution' end,'source_table',table_name,'source_id',item->>'id'));end if;
  end loop;
 end loop;
 -- Resolve only aliases whose exact parent is already validated; never compare descriptions.
 for entry in select value from jsonb_array_elements(sources) loop
  if entry->>'source_table' in('bank_transactions','load_payments','closing_report_payments') and entry->>'classification'='requires_resolution' then
   select value into item from jsonb_array_elements(evidence->(entry->>'source_table')) where value->>'id'=entry->>'source_id';
   select coalesce(jsonb_agg(src),'[]') into resolved from jsonb_array_elements(sources) src
   where src->>'classification' in('exact_canonical_mapping','corrected_receipt_projection','reversed_canonical_payment_projection') and src->>'source_table' in('receivables_payments','payables_payments','receivable_payment_reversals')
   and src->>'amount_cents'=entry->>'amount_cents' and src->>'account_id'=entry->>'account_id' and src->>'occurred_on'=entry->>'occurred_on'
   and exists(select 1 from jsonb_array_elements(evidence->(src->>'source_table')) raw where raw->>'id'=src->>'source_id' and
    (case when entry->>'source_table'='bank_transactions' then raw->>'bank_transaction_id'=item->>'id'
     when entry->>'source_table'='load_payments' then src->>'source_table'='receivables_payments' and raw->>'id'=item->>'receivable_payment_id'
     else src->>'source_table'='receivables_payments' and raw->>'id'=item->>'canonical_receivable_payment_id' end));
   if jsonb_array_length(resolved)=1 then entry:=entry||jsonb_build_object('classification','exact_projection_alias','movement_ids',resolved->0->'movement_ids');end if;
  end if;
  new_sources:=new_sources||jsonb_build_array(entry);
 end loop;
 sources:=new_sources;
 select coalesce(jsonb_agg(b),'[]') into blockers from jsonb_array_elements(blockers) b where not exists(select 1 from jsonb_array_elements(sources) x where x->>'source_table'=b->>'source_table' and x->>'source_id'=b->>'source_id' and x->>'classification'='exact_projection_alias');
 -- Shared movement capacity counts direct money once, excluding projection aliases.
 for m in select movement.value->>0 id,sum((src->>'amount_cents')::numeric) used from jsonb_array_elements(sources) src cross join lateral (select src->'movement_ids' value) movement where src->>'classification'='exact_canonical_mapping' group by movement.value->>0 loop
  if m.used>(select amount_cents from public.finance_movements where tenant_id=_tenant and id=m.id::uuid) then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','legacy_mapping_capacity_exceeded','source_table','finance_movements','source_id',m.id));end if;
 end loop;
 manifest:=jsonb_build_object('version',1,'classifier_version','1','tenant_id',_tenant,'account_id',_account,'from',_from,'to',_to,'sources',sources,'evidence',evidence,'integrity',integrity,'blockers',blockers,'source_count',jsonb_array_length(sources));
 return manifest||jsonb_build_object('revision',md5(manifest::text));
end$$;
revoke all on function finance_private.legacy_cut_manifest(uuid,uuid,date,date) from public,anon,authenticated,service_role;

create function finance_private.legacy_cut_review_status(_tenant uuid,_account uuid,_from date,_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare manifest jsonb;review public.finance_legacy_cut_reviews%rowtype;current boolean;approved boolean;
begin
 manifest:=finance_private.legacy_cut_manifest(_tenant,_account,_from,_to);
 select * into review from public.finance_legacy_cut_reviews where tenant_id=_tenant and bank_account_id=_account and period_start=_from and period_end=_to order by created_at desc,id desc limit 1;
 current:=review.id is not null and review.revision=manifest->>'revision';approved:=current and jsonb_array_length(manifest->'blockers')=0;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'account_id',_account,'from',_from,'to',_to,'revision',manifest->>'revision','current',current,'approved',approved,'can_review',finance_private.can_review_legacy_cut(_tenant),'status',case when approved then 'approved' when review.id is not null then 'needs_review' else 'not_approved' end,'review_id',review.id,'approval',case when review.id is not null then to_jsonb(review)-'snapshot' end,'blockers',manifest->'blockers','manifest',manifest,'history',coalesce((select jsonb_agg(to_jsonb(h)-'snapshot' order by created_at desc,id desc) from public.finance_legacy_cut_reviews h where h.tenant_id=_tenant and h.bank_account_id=_account and h.period_start=_from and h.period_end=_to),'[]'));
end$$;
revoke all on function finance_private.legacy_cut_review_status(uuid,uuid,date,date) from public,anon,service_role;
grant execute on function finance_private.legacy_cut_review_status(uuid,uuid,date,date) to authenticated;
create function public.get_finance_legacy_cut_review(_tenant_id uuid,_account_id uuid,_from date,_to date) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.legacy_cut_review_status(_tenant_id,_account_id,_from,_to)$$;
revoke all on function public.get_finance_legacy_cut_review(uuid,uuid,date,date) from public,anon,service_role;
grant execute on function public.get_finance_legacy_cut_review(uuid,uuid,date,date) to authenticated;

create function public.review_finance_legacy_cut(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;account uuid;request uuid;starts date;ends date;manifest jsonb;prior public.finance_commands%rowtype;actor uuid:=auth.uid();actor_name text;review_id uuid;result jsonb;
begin
 t:=(_payload->>'tenant_id')::uuid;account:=(_payload->>'account_id')::uuid;request:=(_payload->>'request_id')::uuid;starts:=(_payload->>'from')::date;ends:=(_payload->>'to')::date;
 if not finance_private.can_review_legacy_cut(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if jsonb_typeof(_payload) is distinct from 'object' or _payload->'version' is distinct from '1'::jsonb or request is null or account is null or coalesce(_payload->>'revision','') !~ '^[a-f0-9]{32}$' or length(btrim(coalesce(_payload->>'reason',''))) not between 10 and 2000 or _payload->'sources_reviewed' is distinct from 'true'::jsonb or exists(select 1 from jsonb_object_keys(_payload) k where k<>all(array['version','tenant_id','request_id','account_id','from','to','revision','reason','sources_reviewed'])) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform 1 from public.bank_accounts where tenant_id=t and id=account for share;
 if not finance_private.can_review_legacy_cut(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;
 if found then if prior.actor_id<>actor or prior.payload<>_payload or prior.action<>'review_legacy_cut' then raise exception 'finance_request_conflict' using errcode='23505';end if;return prior.result;end if;
 manifest:=finance_private.legacy_cut_manifest(t,account,starts,ends);
 if manifest->>'revision'<>_payload->>'revision' then raise exception 'finance_legacy_cut_changed' using errcode='40001';end if;
 if jsonb_array_length(manifest->'blockers')>0 then raise exception 'finance_legacy_cut_unresolved' using errcode='23514';end if;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into actor_name from auth.users where id=actor;actor_name:=coalesce(actor_name,actor::text);
 insert into public.finance_legacy_cut_reviews(tenant_id,bank_account_id,period_start,period_end,revision,snapshot,actor_id,actor_name,reason) values(t,account,starts,ends,manifest->>'revision',manifest,actor,actor_name,btrim(_payload->>'reason')) returning id into review_id;
 result:=jsonb_build_object('version',1,'tenant_id',t,'account_id',account,'from',starts,'to',ends,'request_id',request,'review_id',review_id,'revision',manifest->>'revision','confirmed',true,'cash_changed',false);
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data) values(t,'legacy_cut',review_id,'legacy_cut_reviewed',actor,actor_name,btrim(_payload->>'reason'),result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'review_legacy_cut',_payload,result);return result;
end$$;
revoke all on function public.review_finance_legacy_cut(jsonb) from public,anon,service_role;
grant execute on function public.review_finance_legacy_cut(jsonb) to authenticated;

do $$begin if to_regprocedure('finance_private.guard_closed_financial_source()') is not null then execute 'create trigger finance_closed_period_source before insert or update or delete on public.finance_legacy_cut_reviews for each row execute function finance_private.guard_closed_financial_source()';end if;end$$;
