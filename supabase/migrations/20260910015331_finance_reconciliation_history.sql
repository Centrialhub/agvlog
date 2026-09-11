-- This is the current consistency of the evidence, not automatic verification
-- of a manual account attestation or certification of the whole bank period.
create function finance_private.reconciliation_evidence_issue(_tenant uuid,_group uuid) returns text
language plpgsql stable security invoker set search_path='' as $$
declare g public.finance_reconciliation_groups%rowtype;account_snapshot jsonb;current_account jsonb;
begin
 select * into g from public.finance_reconciliation_groups where tenant_id=_tenant and id=_group;
 if not found then return 'group_unavailable';end if;
 if (select count(*) from public.finance_bank_entries where tenant_id=_tenant and id=any(g.bank_entry_ids))<>cardinality(g.bank_entry_ids)
  or exists(select 1 from unnest(g.bank_entry_ids) id where not finance_private.bank_entry_active(_tenant,id)) then return 'bank_identity_inactive';end if;
 if exists(select 1 from public.finance_bank_entries e where e.tenant_id=_tenant and e.id=any(g.bank_entry_ids)
  and (select v.outcome from public.finance_statement_verifications v where v.tenant_id=_tenant and v.import_id=e.first_import_id order by v.created_at desc,v.id desc limit 1) is distinct from 'rows_match') then
  return 'source_changed';end if;
 select value into account_snapshot from jsonb_array_elements(g.evidence_snapshot->'accounts') where value->>'id'=g.bank_account_id::text;
 select jsonb_build_object('id',a.id,'bank_code',to_jsonb(a)->'bank_code','branch_number',to_jsonb(a)->'branch_number',
  'account_number',to_jsonb(a)->'account_number','account_type',to_jsonb(a)->'account_type') into current_account
 from public.bank_accounts a where a.tenant_id=_tenant and a.id=g.bank_account_id;
 if current_account is null or account_snapshot is null or current_account is distinct from (account_snapshot-'name'-'bank_name') then return 'account_changed';end if;
 return null;
end;$$;
revoke all on function finance_private.reconciliation_evidence_issue(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.reconciliation_history(_tenant uuid,_import uuid,_page integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page not between 1 and 1000000 then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 if not exists(select 1 from public.finance_statement_imports where tenant_id=_tenant and id=_import) then raise exception 'finance_statement_not_found' using errcode='22023';end if;
 with related_entries as materialized(
  select e.id from public.finance_bank_entries e where e.tenant_id=_tenant and (e.first_import_id=_import
   or exists(select 1 from public.finance_statement_rows r where r.tenant_id=_tenant and r.import_id=_import and r.bank_entry_id=e.id)
   or exists(select 1 from public.finance_statement_identity_reviews ir join public.finance_statement_rows sr on sr.id=ir.row_id and sr.tenant_id=ir.tenant_id
    where ir.tenant_id=_tenant and sr.import_id=_import and ir.bank_entry_id=e.id))
 ), filtered as materialized(
  select g.*,r.id reversal_id,r.actor_id reversed_by,r.actor_name reversed_by_name,r.reason reversal_reason,r.created_at reversed_at
  from public.finance_reconciliation_groups g left join public.finance_reconciliation_reversals r on r.tenant_id=g.tenant_id and r.group_id=g.id
  where g.tenant_id=_tenant and g.bank_entry_ids&&array(select id from related_entries)
 ), paged as(select * from filtered order by created_at desc,id desc limit 20 offset (_page-1)*20)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'import_id',_import,'page',_page,'page_size',20,
  'total',(select count(*) from filtered),'active_count',(select count(*) from filtered where reversal_id is null),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'tenant_id',p.tenant_id,'bank_account_id',p.bank_account_id,
   'direction',p.direction,'amount_cents',p.amount_cents::text,'method',p.method,'actor_id',p.actor_id,'actor_name',p.actor_name,
   'reason',p.reason,'account_evidence',p.account_evidence,'created_at',p.created_at,'evidence_issue',finance_private.reconciliation_evidence_issue(_tenant,p.id),
   'movement_count',cardinality(p.movement_ids),'bank_entry_count',cardinality(p.bank_entry_ids),
   'movements',(select jsonb_agg(jsonb_build_object('id',m->>'id','description',m->>'description','counterparty',m->>'beneficiary_name','date',m->>'occurred_on','amount_cents',m->>'amount_cents')) from jsonb_array_elements(p.evidence_snapshot->'movements') m),
   'entries',(select jsonb_agg(jsonb_build_object('id',e->>'id','description',e->>'description','counterparty',e->>'counterparty_name','date',e->>'posted_on','amount_cents',e->>'amount_cents')) from jsonb_array_elements(p.evidence_snapshot->'entries') e),
   'reversal',case when p.reversal_id is null then null else jsonb_build_object('id',p.reversal_id,'actor_id',p.reversed_by,'actor_name',p.reversed_by_name,'reason',p.reversal_reason,'created_at',p.reversed_at) end)
   order by p.created_at desc,p.id desc) from paged p),'[]')) into result;
 return result;
end;$$;
revoke all on function finance_private.reconciliation_history(uuid,uuid,integer) from public,anon,authenticated,service_role;
create function public.list_finance_reconciliation_history(_tenant_id uuid,_import_id uuid,_page integer default 1) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.reconciliation_history(_tenant_id,_import_id,_page);$$;
revoke all on function public.list_finance_reconciliation_history(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_finance_reconciliation_history(uuid,uuid,integer),finance_private.reconciliation_history(uuid,uuid,integer) to authenticated;
