-- New statement-account corrections use the canonical entity type and both
-- correction commands explicitly identify themselves as manual interventions.
create or replace function public.reassign_finance_statement_account_v1(
  _tenant_id uuid,
  _import_id uuid,
  _account_id uuid,
  _reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  statement_import public.finance_statement_imports%rowtype;
  old_account uuid;
  entry_ids uuid[];
  actor_name text;
begin
  perform finance_private.require_access(_tenant_id);
  if length(btrim(coalesce(_reason,'')))<10 then
    raise exception 'reason_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(_tenant_id::text||':finance',0));
  select * into statement_import
  from public.finance_statement_imports
  where tenant_id=_tenant_id and id=_import_id
  for update;
  if not found then raise exception 'statement_not_found';end if;
  old_account:=statement_import.bank_account_id;
  if not exists(
    select 1 from public.bank_accounts
    where tenant_id=_tenant_id and id=_account_id and active and account_type<>'cash'
  ) then raise exception 'invalid_target_account';end if;
  select array_agg(id) into entry_ids
  from public.finance_bank_entries
  where tenant_id=_tenant_id and first_import_id=_import_id;
  if exists(
    select 1 from public.finance_reconciliation_groups
    where tenant_id=_tenant_id and bank_entry_ids && coalesce(entry_ids,'{}'::uuid[])
  ) then raise exception 'statement_already_reconciled';end if;
  if exists(
    select 1
    from public.finance_statement_identity_reviews review
    join public.finance_statement_rows statement_row
      on statement_row.tenant_id=review.tenant_id and statement_row.id=review.row_id
    where statement_row.import_id=_import_id
  ) then raise exception 'statement_identity_review_exists';end if;
  update public.finance_statement_imports
    set bank_account_id=_account_id
  where tenant_id=_tenant_id and id=_import_id;
  update public.finance_bank_entries
    set bank_account_id=_account_id
  where tenant_id=_tenant_id and first_import_id=_import_id;
  select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,auth.uid()::text)
    into actor_name from auth.users where id=auth.uid();
  insert into public.finance_events(
    tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data
  ) values (
    _tenant_id,'statement_import',_import_id,'statement_account_reassigned',auth.uid(),
    coalesce(actor_name,auth.uid()::text),btrim(_reason),
    jsonb_build_object('bank_account_id',old_account),
    jsonb_build_object('bank_account_id',_account_id,'manual_intervention',true)
  );
  return jsonb_build_object('confirmed',true,'import_id',_import_id,'bank_account_id',_account_id);
end;
$function$;

revoke all on function public.reassign_finance_statement_account_v1(uuid,uuid,uuid,text)
from public,anon,authenticated,service_role;
grant execute on function public.reassign_finance_statement_account_v1(uuid,uuid,uuid,text)
to authenticated;

-- Keep the latest idempotent reversal body and add the explicit manual marker
-- when this migration follows a database that already ran the previous file.
do $patch_refund_reversal$
declare
  body text;
  needle text := 'jsonb_build_object(''reversal_id'',reversal_id,''refund_id'',refund.id,''request_id'',_request_id)';
  replacement text := 'jsonb_build_object(''reversal_id'',reversal_id,''refund_id'',refund.id,''request_id'',_request_id,''manual_intervention'',true)';
begin
  select pg_get_functiondef(
    'public.reverse_finance_customer_credit_refund_v1(uuid,uuid,text,uuid)'::regprocedure
  ) into body;
  if position(replacement in body)=0 then
    if position(needle in body)=0 then raise exception 'refund_reversal_audit_contract_changed';end if;
    execute replace(body,needle,replacement);
  end if;
end;
$patch_refund_reversal$;

-- Existing events did not carry the marker. Add both actions to the historical
-- fallback and let audit enrichment resolve the legacy entity type too.
do $patch_audit$
declare
  body text;
  action_anchor text := '''payroll_period_cancelled'',''payroll_period_reopened''';
  action_replacement text := '''payroll_period_cancelled'',''payroll_period_reopened'',''statement_account_reassigned'',''customer_credit_refund_reversed''';
  join_anchor text := 'paged_row.entity_type=''statement_import''';
  join_replacement text := 'paged_row.entity_type in(''statement_import'',''finance_statement_import'')';
begin
  select pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure) into body;
  if position('''statement_account_reassigned''' in body)=0 then
    if position(action_anchor in body)=0 then raise exception 'finance_audit_action_contract_changed';end if;
    body:=replace(body,action_anchor,action_replacement);
  end if;
  if position(join_replacement in body)=0 then
    if position(join_anchor in body)=0 then raise exception 'finance_audit_statement_join_contract_changed';end if;
    body:=replace(body,join_anchor,join_replacement);
  end if;
  execute body;
end;
$patch_audit$;

create or replace function finance_private.statement_history(
  _tenant uuid,
  _import uuid,
  _page integer default 1,
  _page_size integer default 30,
  _snapshot_at timestamptz default null
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  snapshot_at timestamptz:=coalesce(_snapshot_at,clock_timestamp());
begin
  if not finance_private.can_access(_tenant) then
    raise exception 'finance_access_denied' using errcode='42501';
  end if;
  if _page not between 1 and 1000000 or _page_size not between 1 and 100 then
    raise exception 'finance_invalid_statement_history_page' using errcode='22023';
  end if;
  if _snapshot_at is not null and _snapshot_at>clock_timestamp() then
    raise exception 'finance_invalid_statement_history_snapshot' using errcode='22023';
  end if;
  if not exists(
    select 1 from public.finance_statement_imports
    where tenant_id=_tenant and id=_import
  ) then raise exception 'finance_statement_not_found' using errcode='22023';end if;

  return jsonb_build_object(
    'version',1,'tenant_id',_tenant,'import_id',_import,'page',_page,'page_size',_page_size,
    'snapshot_at',snapshot_at,
    'total',(
      select count(*) from public.finance_events event
      where event.tenant_id=_tenant
        and event.entity_type in('statement_import','finance_statement_import')
        and event.entity_id=_import and event.created_at<=snapshot_at
    ),
    'rows',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',event.id,'actor_name',event.actor_name,'actor_id',event.actor_id,
        'action',event.action,'reason',event.reason,'created_at',event.created_at
      ) order by event.created_at desc,event.id desc)
      from (
        select * from public.finance_events
        where tenant_id=_tenant
          and entity_type in('statement_import','finance_statement_import')
          and entity_id=_import and created_at<=snapshot_at
        order by created_at desc,id desc
        limit _page_size offset (_page-1)*_page_size
      ) event
    ),'[]'::jsonb)
  );
end;
$function$;

revoke all on function finance_private.statement_history(uuid,uuid,integer,integer,timestamptz)
from public,anon,authenticated,service_role;
grant execute on function finance_private.statement_history(uuid,uuid,integer,integer,timestamptz)
to authenticated;
