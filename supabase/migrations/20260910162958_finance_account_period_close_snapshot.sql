-- Full evidence producer: no page limits and no money inferred from obligations.
create function finance_private.account_period_close_snapshot(_tenant uuid,_account uuid,_from date,_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare account public.bank_accounts%rowtype;o public.finance_account_openings%rowtype;predecessor public.finance_account_period_closures%rowtype;
 coverage jsonb;opening jsonb;review jsonb;legacy jsonb;facts jsonb;result jsonb;dependencies jsonb;reasons text[]:='{}';k text;
 initial numeric;closing numeric;guards boolean:=false;overlap boolean;opening_evidence jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _from is null or _to is null or not isfinite(_from) or not isfinite(_to) or _from>_to or _to-_from>=366 then raise exception 'finance_invalid_period' using errcode='22023';end if;
 select * into account from public.bank_accounts where tenant_id=_tenant and id=_account;
 if not found then raise exception 'finance_account_not_found' using errcode='22023';end if;
 if account.active is distinct from true or account.account_type not in('checking','savings') then reasons:=array_append(reasons,'bank_account_required');end if;
 if _to>=(statement_timestamp() at time zone 'America/Sao_Paulo')::date then reasons:=array_append(reasons,'period_not_finished');end if;
 review:=finance_private.account_period_review(_tenant,_account,_from,_to);
 coverage:=finance_private.statement_coverage_review(_tenant,_account,_from,_to);
 opening:=finance_private.account_opening(_tenant,_account,_from,_to);
 select * into o from public.finance_account_openings a where tenant_id=_tenant and bank_account_id=_account
  and not exists(select 1 from public.finance_account_opening_reversals r where r.tenant_id=a.tenant_id and r.opening_id=a.id);
 select * into predecessor from public.finance_account_period_closures c where c.tenant_id=_tenant and c.account_id=_account and c.period_end<_from
  and not exists(select 1 from public.finance_account_period_reopenings r where r.tenant_id=c.tenant_id and r.closure_id=c.id) order by c.period_end desc,c.id limit 1;
 select exists(select 1 from public.finance_account_period_closures c where c.tenant_id=_tenant and c.account_id=_account and c.period_start<=_to and c.period_end>=_from
  and not exists(select 1 from public.finance_account_period_reopenings r where r.tenant_id=c.tenant_id and r.closure_id=c.id)) into overlap;
 if overlap then reasons:=array_append(reasons,'period_already_closed');end if;
 if o.id is null or opening#>>'{opening,evidence_status}' is distinct from 'valid' then reasons:=array_append(reasons,'opening_requires_review');end if;
 if predecessor.id is null then
  if o.effective_from is distinct from _from then reasons:=array_append(reasons,'period_must_start_at_opening');end if;initial:=o.balance_cents;
 else
  if predecessor.period_end+1<>_from or predecessor.opening_id is distinct from o.id then reasons:=array_append(reasons,'predecessor_not_contiguous');end if;
  initial:=nullif(predecessor.snapshot#>>'{balances,closing_cents}','')::numeric;
 end if;
 if coverage->>'status' is distinct from 'approved' or coverage->'current' is distinct from 'true'::jsonb then reasons:=array_append(reasons,'coverage_requires_review');end if;
 closing:=nullif(coverage#>>'{evidence,closing_balance_cents}','')::numeric;
 if initial is null or closing is null or initial is distinct from nullif(coverage#>>'{evidence,opening_balance_cents}','')::numeric
  or initial+(review#>>'{recorded,net_cents}')::numeric is distinct from closing then reasons:=array_append(reasons,'balance_mismatch');end if;
 if review#>>'{difference,in_cents}' is distinct from '0' or review#>>'{difference,out_cents}' is distinct from '0' or review#>>'{difference,net_cents}' is distinct from '0' then reasons:=array_append(reasons,'bank_ledger_difference');end if;
 foreach k in array array['unmatched_bank_count','unmatched_movement_count','evidence_review_count','cross_period_count','unverified_entry_count','unresolved_row_count'] loop
  if coalesce((review->>k)::bigint,-1)<>0 then reasons:=array_append(reasons,k);end if;
 end loop;
 if to_regprocedure('finance_private.legacy_cut_review_status(uuid,uuid,date,date)') is null then
  legacy:=jsonb_build_object('current',false,'approved',false,'status','not_approved','blockers',jsonb_build_array('classifier_missing'));reasons:=array_append(reasons,'legacy_classifier_missing');
 else
  execute 'select finance_private.legacy_cut_review_status($1,$2,$3,$4)' into legacy using _tenant,_account,_from,_to;
  if legacy->'current' is distinct from 'true'::jsonb or legacy->'approved' is distinct from 'true'::jsonb
   or jsonb_typeof(legacy->'blockers') is distinct from 'array' or legacy->'blockers' is distinct from '[]'::jsonb
   then reasons:=array_append(reasons,'legacy_cut_requires_review');end if;
 end if;
 if to_regprocedure('finance_private.account_period_guards_ready()') is not null then execute 'select finance_private.account_period_guards_ready()' into guards;end if;
 if guards is distinct from true then reasons:=array_append(reasons,'period_guards_incomplete');end if;
 if o.id is not null then opening_evidence:=finance_private.statement_period_evidence(_tenant,_account,o.effective_from,o.evidence_to);end if;
 with movements as materialized(select * from public.finance_movements where tenant_id=_tenant and bank_account_id=_account and occurred_on between _from and _to),
 groups as materialized(select g.* from public.finance_reconciliation_groups g where g.tenant_id=_tenant and g.bank_account_id=_account and
  (g.movement_ids&&array(select id from movements) or exists(select 1 from public.finance_bank_entries e where e.tenant_id=_tenant and e.id=any(g.bank_entry_ids) and e.posted_on between _from and _to))),
 active_groups as(select * from groups g where not exists(select 1 from public.finance_reconciliation_reversals r where r.tenant_id=g.tenant_id and r.group_id=g.id)),
 group_members as(select 'movement' kind,unnest(movement_ids) id from active_groups union all select 'bank',unnest(bank_entry_ids) from active_groups)
 select jsonb_build_object('movements',coalesce((select jsonb_agg(to_jsonb(m) order by id) from movements m),'[]'),
  'groups',coalesce((select jsonb_agg(to_jsonb(g) order by id) from groups g),'[]'),
  'group_reversals',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.finance_reconciliation_reversals r join groups g on g.tenant_id=r.tenant_id and g.id=r.group_id),'[]'),
  'duplicate_group_members',(select count(*) from(select kind,id from group_members group by kind,id having count(*)>1)d),
  'pending_jobs',coalesce((select jsonb_agg(to_jsonb(j) order by j.verification_id) from public.finance_automatic_reconciliation_jobs j
    where j.tenant_id=_tenant and j.status='pending' and exists(select 1 from jsonb_array_elements(coverage#>'{dependencies,imports}') imp where imp->>'id'=j.import_id::text)),'[]'),
  'opening_imports',coalesce((select jsonb_agg(to_jsonb(i)-'source_snapshot' order by i.id) from public.finance_statement_imports i where i.tenant_id=_tenant
    and exists(select 1 from jsonb_array_elements(opening_evidence->'anchors') a where a->>'day'=(o.effective_from-1)::text and a->>'import_id'=i.id::text)),'[]'),
  'opening_verifications',coalesce((select jsonb_agg(to_jsonb(v) order by v.id) from public.finance_statement_verifications v where v.tenant_id=_tenant
    and exists(select 1 from jsonb_array_elements(opening_evidence->'anchors') a where a->>'day'=(o.effective_from-1)::text and a->>'verification_id'=v.id::text)),'[]'),
  'transfers',coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.finance_internal_transfers t where t.tenant_id=_tenant and exists(select 1 from public.finance_movements m where m.tenant_id=_tenant and m.bank_account_id=_account and m.occurred_on<=_to and m.id in(t.outgoing_id,t.incoming_id))),'[]'),
  'transfer_departures',coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from public.finance_transfer_departures d where d.tenant_id=_tenant and exists(select 1 from public.finance_movements m where m.tenant_id=_tenant and m.occurred_on<=_to and m.id=d.outgoing_id and (m.bank_account_id=_account or d.destination_account_id=_account))),'[]')
 ) into facts;
 if (facts->>'duplicate_group_members')::bigint>0 then reasons:=array_append(reasons,'duplicate_reconciliation_members');end if;
 if jsonb_array_length(facts->'pending_jobs')>0 then reasons:=array_append(reasons,'reconciliation_processing_pending');end if;
 with sources(kind,role,rows) as(values
  ('finance_movements','money',facts->'movements'),('finance_reconciliation_groups','bank_evidence',facts->'groups'),('finance_reconciliation_reversals','bank_evidence',facts->'group_reversals'),
  ('finance_statement_imports','bank_evidence',coverage#>'{dependencies,imports}'),('finance_statement_rows','bank_evidence',coverage#>'{dependencies,rows}'),
  ('finance_statement_verifications','bank_evidence',coverage#>'{dependencies,verifications}'),('finance_bank_entries','money',coverage#>'{dependencies,bank_entries}'),
  ('finance_statement_identity_reviews','bank_evidence',coverage#>'{dependencies,identity_reviews}'),('finance_statement_review_reversals','bank_evidence',coverage#>'{dependencies,identity_reversals}'),
  ('finance_statement_imports','opening',facts->'opening_imports'),('finance_statement_verifications','opening',facts->'opening_verifications'),
  ('finance_account_openings','opening',case when o.id is null then '[]'::jsonb else jsonb_build_array(to_jsonb(o)) end),
  ('finance_account_period_closures','predecessor',case when predecessor.id is null then '[]'::jsonb else jsonb_build_array(to_jsonb(predecessor)-'snapshot') end),
  ('finance_statement_coverage_approvals','bank_evidence',case when coverage->'approval' is null or coverage->'approval'='null'::jsonb then '[]'::jsonb else jsonb_build_array(coverage->'approval') end),
  ('finance_legacy_cut_reviews','legacy_review',case when legacy->>'review_id' is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('id',legacy->>'review_id','revision',legacy->>'revision')) end),
  ('finance_internal_transfers','composition_snapshot',facts->'transfers'),('finance_transfer_departures','composition_snapshot',facts->'transfer_departures')
 ), expanded as(select kind,role,row from sources cross join lateral jsonb_array_elements(coalesce(rows,'[]'))row),
 unique_sources as(select distinct on(kind,row->>'id') kind,role,row from expanded order by kind,row->>'id',case role when 'opening' then 0 else 1 end)
 select coalesce(jsonb_agg(jsonb_build_object('source_kind',kind,'source_id',row->>'id','source_revision',md5(row::text),'account_id',_account,
  'affected_from',case when role='opening' then least(_from-1,o.effective_from-1) else _from end,'affected_to',_to,'dependency_role',role) order by kind,row->>'id'),'[]') into dependencies from unique_sources;
 select coalesce(array_agg(distinct reason order by reason),'{}') into reasons from unnest(reasons)reason;
 result:=jsonb_build_object('version',1,'tenant_id',_tenant,'account_id',_account,'from',_from,'to',_to,'currency','BRL','timezone','America/Sao_Paulo',
  'eligible',cardinality(reasons)=0,'blockers',(select coalesce(jsonb_agg(jsonb_build_object('code',r,'source_table',null,'source_ids','[]'::jsonb,'scope','account') order by r),'[]') from unnest(reasons)r),
  'opening_id',o.id,'predecessor_id',predecessor.id,'balances',jsonb_build_object('opening_cents',initial::text,'closing_cents',closing::text,
   'bank_in_cents',review#>>'{bank,in_cents}','bank_out_cents',review#>>'{bank,out_cents}','recorded_in_cents',review#>>'{recorded,in_cents}','recorded_out_cents',review#>>'{recorded,out_cents}'),
  'account',coverage#>'{dependencies,account}','opening',opening,'coverage',coverage,'legacy',legacy,'period_review',review,'facts',facts,'dependencies',dependencies);
 return result||jsonb_build_object('revision',md5(result::text));
end$$;
revoke all on function finance_private.account_period_close_snapshot(uuid,uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function finance_private.account_period_close_snapshot(uuid,uuid,date,date) to authenticated;
grant execute on function finance_private.can_close_account_period(uuid) to authenticated;
create function public.preview_finance_account_period_close(_tenant_id uuid,_account_id uuid,_from date,_to date)
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.account_period_close_snapshot(_tenant_id,_account_id,_from,_to)||jsonb_build_object('can_execute',finance_private.can_close_account_period(_tenant_id))$$;
revoke all on function public.preview_finance_account_period_close(uuid,uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function public.preview_finance_account_period_close(uuid,uuid,date,date) to authenticated;
