alter function finance_private.statement_coverage_snapshot(uuid,uuid,date,date) rename to statement_coverage_snapshot_full;

create function finance_private.statement_coverage_compact_dependencies(_dependencies jsonb) returns jsonb
language sql immutable security definer set search_path='' as $$select coalesce(jsonb_object_agg(key,case when jsonb_typeof(value)='array' then jsonb_build_object('count',jsonb_array_length(value),'revision',md5(value::text)) else value end order by key),'{}') from jsonb_each(coalesce(_dependencies,'{}'))$$;
revoke all on function finance_private.statement_coverage_compact_dependencies(jsonb) from public,anon,authenticated,service_role;

create function finance_private.statement_coverage_compact_snapshot(_snapshot jsonb) returns jsonb
language sql immutable security definer set search_path='' as $$
 select (_snapshot-'evidence'::text-'dependencies'::text)||jsonb_build_object('dependencies',finance_private.statement_coverage_compact_dependencies(_snapshot->'dependencies'),'evidence',((_snapshot->'evidence')-'source_evidence'::text-'anchors'::text)||jsonb_build_object(
  'source_evidence_count',coalesce(jsonb_array_length(_snapshot->'evidence'->'source_evidence'),0),
  'anchors',coalesce((select jsonb_agg(value order by ordinality) from jsonb_array_elements(_snapshot->'evidence'->'anchors') with ordinality where ordinality<=20),'[]'::jsonb),
  'anchors_has_more',coalesce(jsonb_array_length(_snapshot->'evidence'->'anchors'),0)>20))
$$;
revoke all on function finance_private.statement_coverage_compact_snapshot(jsonb) from public,anon,authenticated,service_role;

do $$declare body text;start_at integer;end_at integer;replacement text;needle text;begin
 select pg_get_functiondef('finance_private.statement_coverage_snapshot_full(uuid,uuid,date,date)'::regprocedure) into body;
 body:=replace(body,'FUNCTION finance_private.statement_coverage_snapshot_full','FUNCTION finance_private.statement_coverage_snapshot');
 start_at:=position(E' select jsonb_build_object(\n  ''account''' in body);
 end_at:=position(E' ) into dependencies;' in substring(body from start_at));
 if start_at=0 or end_at=0 then raise exception 'finance_statement_coverage_dependencies_changed';end if;
 end_at:=start_at+end_at+length(E' ) into dependencies;')-2;
 replacement:=$sql$ select jsonb_build_object(
  'account',(select jsonb_build_object('id',a.id,'tenant_id',a.tenant_id,'active',a.active,'bank_code',to_jsonb(a)->'bank_code','branch_number',to_jsonb(a)->'branch_number','account_number',to_jsonb(a)->'account_number','account_type',a.account_type) from public.bank_accounts a where a.tenant_id=_tenant and a.id=_account),
  'imports',(select jsonb_build_object('count',count(*),'revision',md5(coalesce(string_agg(md5((to_jsonb(i)-'source_snapshot'::text)::text),'' order by i.id),''))) from imports i),
  'rows',(select jsonb_build_object('count',count(*),'revision',md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' order by r.id),''))) from rows r),
  'verifications',(select jsonb_build_object('count',count(*),'revision',md5(coalesce(string_agg(md5(to_jsonb(v)::text),'' order by v.import_id),''))) from verifications v),
  'bank_entries',(select jsonb_build_object('count',count(*),'revision',md5(coalesce(string_agg(md5((to_jsonb(e)||jsonb_build_object('active',finance_private.bank_entry_active(_tenant,e.id)))::text),'' order by e.id),''))) from public.finance_bank_entries e where e.tenant_id=_tenant and e.bank_account_id=_account and e.posted_on between _from and _to),
  'identity_reviews',(select jsonb_build_object('count',count(*),'revision',md5(coalesce(string_agg(md5(to_jsonb(ir)::text),'' order by ir.id),''))) from reviews ir),
  'identity_reversals',(select jsonb_build_object('count',count(*),'revision',md5(coalesce(string_agg(md5(to_jsonb(rv)::text),'' order by rv.id),''))) from public.finance_statement_review_reversals rv join reviews ir on ir.tenant_id=rv.tenant_id and ir.id=rv.review_id),
  'unsupported_sources',(select count(*) from imports where parser_version<>'native-ofx-v1'),
  'unverified_sources',(select count(*) from imports i where not exists(select 1 from verifications v where v.import_id=i.id and v.outcome='rows_match')),
  'unresolved_rows',(select count(*) from rows r where r.classification in('ambiguous','reference_conflict','repeated_reference') and not exists(select 1 from reviews ir where ir.row_id=r.id and not exists(select 1 from public.finance_statement_review_reversals rv where rv.tenant_id=ir.tenant_id and rv.review_id=ir.id)))
 ) into dependencies;$sql$;
 body:=substring(body from 1 for start_at-1)||replacement||substring(body from end_at+1);
 needle:='return result||jsonb_build_object(''revision'',md5(result::text));';
 if position(needle in body)=0 then raise exception 'finance_statement_coverage_revision_changed';end if;
 execute replace(body,needle,'return finance_private.statement_coverage_compact_snapshot(result)||jsonb_build_object(''revision'',md5(result::text));');
end$$;

create function finance_private.statement_coverage_review_full(_tenant uuid,_account uuid,_from date,_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare snapshot jsonb;review_snapshot jsonb;approval public.finance_statement_coverage_approvals%rowtype;current boolean:=false;status text;begin
 snapshot:=finance_private.statement_coverage_snapshot_full(_tenant,_account,_from,_to);
 review_snapshot:=finance_private.statement_coverage_snapshot(_tenant,_account,_from,_to);
 select a.* into approval from public.finance_statement_coverage_approvals a where a.tenant_id=_tenant and a.bank_account_id=_account and a.period_start=_from and a.period_end=_to and not exists(select 1 from public.finance_statement_coverage_reversals r where r.tenant_id=a.tenant_id and r.approval_id=a.id) order by a.created_at desc,a.id desc limit 1;
 if found then current:=approval.revision=review_snapshot->>'revision' and (review_snapshot->>'can_approve')::boolean;status:=case when current then 'approved' else 'needs_review' end;end if;
 return snapshot||jsonb_build_object('revision',review_snapshot->>'revision','status',coalesce(status,'not_approved'),'current',current,'can_approve',(review_snapshot->>'can_approve')::boolean and approval.id is null,'approval',case when approval.id is null then null else (to_jsonb(approval)-'snapshot'::text)||jsonb_build_object('snapshot',finance_private.statement_coverage_compact_snapshot(approval.snapshot)) end,'history','[]'::jsonb,'history_has_more',false);
end$$;
revoke all on function finance_private.statement_coverage_review_full(uuid,uuid,date,date) from public,anon,authenticated,service_role;

create function finance_private.statement_coverage_history(_tenant uuid,_account uuid,_from date,_to date,_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare rows jsonb;begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page not between 1 and 100000 then raise exception 'finance_invalid_page' using errcode='22023';end if;
 if not exists(select 1 from public.bank_accounts where tenant_id=_tenant and id=_account) then raise exception 'finance_account_not_found' using errcode='22023';end if;
 select coalesce(jsonb_agg((to_jsonb(a)-'snapshot')||jsonb_build_object('snapshot',finance_private.statement_coverage_compact_snapshot(a.snapshot),'reversal',(select to_jsonb(r) from public.finance_statement_coverage_reversals r where r.tenant_id=a.tenant_id and r.approval_id=a.id)) order by a.created_at desc,a.id desc),'[]') into rows from(select * from public.finance_statement_coverage_approvals where tenant_id=_tenant and bank_account_id=_account and period_start=_from and period_end=_to order by created_at desc,id desc limit 20 offset((_page-1)*20))a;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'account_id',_account,'from',_from,'to',_to,'page',_page,'page_size',20,'has_more',exists(select 1 from public.finance_statement_coverage_approvals where tenant_id=_tenant and bank_account_id=_account and period_start=_from and period_end=_to offset(_page*20)),'rows',rows);
end$$;
revoke all on function finance_private.statement_coverage_history(uuid,uuid,date,date,integer) from public,anon,authenticated,service_role;
grant execute on function finance_private.statement_coverage_history(uuid,uuid,date,date,integer) to authenticated;
create function public.get_finance_statement_coverage_history(_tenant_id uuid,_account_id uuid,_from date,_to date,_page integer default 1) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.statement_coverage_history(_tenant_id,_account_id,_from,_to,_page)$$;
revoke all on function public.get_finance_statement_coverage_history(uuid,uuid,date,date,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_statement_coverage_history(uuid,uuid,date,date,integer) to authenticated;

do $$declare body text;needle text;replacement text;begin
 select pg_get_functiondef('finance_private.statement_coverage_review(uuid,uuid,date,date)'::regprocedure) into body;
 needle:=$old$select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('reversal',(select to_jsonb(r) from public.finance_statement_coverage_reversals r where r.tenant_id=a.tenant_id and r.approval_id=a.id)) order by a.created_at desc,a.id desc),'[]') into history
  from public.finance_statement_coverage_approvals a where a.tenant_id=_tenant and a.bank_account_id=_account and a.period_start=_from and a.period_end=_to;$old$;
 replacement:=$new$select coalesce(jsonb_agg((to_jsonb(a)-'snapshot')||jsonb_build_object('snapshot',finance_private.statement_coverage_compact_snapshot(a.snapshot),'reversal',(select to_jsonb(r) from public.finance_statement_coverage_reversals r where r.tenant_id=a.tenant_id and r.approval_id=a.id)) order by a.created_at desc,a.id desc),'[]') into history
  from(select * from public.finance_statement_coverage_approvals where tenant_id=_tenant and bank_account_id=_account and period_start=_from and period_end=_to order by created_at desc,id desc limit 20)a;$new$;
 if position(needle in body)=0 then raise exception 'finance_statement_coverage_history_changed';end if;body:=replace(body,needle,replacement);
 needle:='''approval'',case when approval.id is null then null else to_jsonb(approval) end,''history'',history';
 if position(needle in body)=0 then raise exception 'finance_statement_coverage_envelope_changed';end if;
 execute replace(body,needle,'''approval'',case when approval.id is null then null else (to_jsonb(approval)-''snapshot'')||jsonb_build_object(''snapshot'',finance_private.statement_coverage_compact_snapshot(approval.snapshot)) end,''history'',history,''history_has_more'',exists(select 1 from public.finance_statement_coverage_approvals where tenant_id=_tenant and bank_account_id=_account and period_start=_from and period_end=_to offset 20)');
end$$;

do $$declare body text;needle text;begin
 if to_regprocedure('finance_private.account_period_close_snapshot(uuid,uuid,date,date)') is null then return;end if;
 select pg_get_functiondef('finance_private.account_period_close_snapshot(uuid,uuid,date,date)'::regprocedure) into body;
 needle:='coverage:=finance_private.statement_coverage_review(_tenant,_account,_from,_to);';
 if position(needle in body)=0 then raise exception 'finance_account_close_coverage_reader_changed';end if;
 execute replace(body,needle,'coverage:=finance_private.statement_coverage_review_full(_tenant,_account,_from,_to);');
end$$;
