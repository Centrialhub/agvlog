create or replace function public.reassign_finance_statement_account_v1(
  _tenant_id uuid,_import_id uuid,_account_id uuid,_reason text,_request_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  statement_import public.finance_statement_imports%rowtype;old_account uuid;entry_ids uuid[];actor_name text;
  payload_hash text;key_value text;cached public.idempotency_keys%rowtype;result jsonb;
begin
  perform finance_private.require_access(_tenant_id);
  if _request_id is null or length(btrim(coalesce(_reason,'')))<10 then
    raise exception 'invalid_statement_account_reassignment' using errcode='22023';
  end if;
  payload_hash:=encode(sha256(convert_to(jsonb_build_object(
    'import_id',_import_id,'account_id',_account_id,'reason',btrim(_reason)
  )::text,'UTF8')),'hex');
  key_value:='statement_account_reassign:'||auth.uid()::text||':'||_request_id::text;
  perform pg_advisory_xact_lock(hashtextextended(_tenant_id::text||':finance',0));
  select * into cached from public.idempotency_keys
  where tenant_id=_tenant_id and public.idempotency_keys.key_value=key_value;
  if found then
    if cached.operation is distinct from 'statement_account_reassign'
       or cached.payload_hash is distinct from payload_hash then
      raise exception 'statement_account_reassignment_idempotency_mismatch' using errcode='22023';
    end if;
    if cached.response_body is null or cached.response_body->>'request_id' is distinct from _request_id::text then
      raise exception 'statement_account_reassignment_replay_invalid' using errcode='23514';
    end if;
    return cached.response_body;
  end if;

  select * into statement_import from public.finance_statement_imports
  where tenant_id=_tenant_id and id=_import_id for update;
  if not found then raise exception 'statement_not_found';end if;
  old_account:=statement_import.bank_account_id;
  if old_account=_account_id then
    raise exception 'statement_account_unchanged' using errcode='22023';
  end if;
  if not exists(select 1 from public.bank_accounts
    where tenant_id=_tenant_id and id=_account_id and active and account_type<>'cash') then
    raise exception 'invalid_target_account';
  end if;
  select array_agg(id) into entry_ids from public.finance_bank_entries
  where tenant_id=_tenant_id and first_import_id=_import_id;
  if exists(select 1 from public.finance_reconciliation_groups
    where tenant_id=_tenant_id and bank_entry_ids&&coalesce(entry_ids,'{}'::uuid[])) then
    raise exception 'statement_already_reconciled';
  end if;
  if exists(select 1 from public.finance_statement_identity_reviews review
    join public.finance_statement_rows statement_row on statement_row.tenant_id=review.tenant_id and statement_row.id=review.row_id
    where statement_row.import_id=_import_id) then raise exception 'statement_identity_review_exists';end if;
  update public.finance_statement_imports set bank_account_id=_account_id
  where tenant_id=_tenant_id and id=_import_id;
  update public.finance_bank_entries set bank_account_id=_account_id
  where tenant_id=_tenant_id and first_import_id=_import_id;
  select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,auth.uid()::text)
  into actor_name from auth.users where id=auth.uid();
  insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
  values(_tenant_id,'statement_import',_import_id,'statement_account_reassigned',auth.uid(),
    coalesce(actor_name,auth.uid()::text),btrim(_reason),jsonb_build_object('bank_account_id',old_account),
    jsonb_build_object('bank_account_id',_account_id,'manual_intervention',true,'request_id',_request_id));
  result:=jsonb_build_object('confirmed',true,'import_id',_import_id,'bank_account_id',_account_id,'request_id',_request_id);
  insert into public.idempotency_keys(tenant_id,key_value,operation,idempotency_key,payload_hash,result_id,response_body)
  values(_tenant_id,key_value,'statement_account_reassign',_request_id::text,payload_hash,_import_id,result);
  return result;
end;
$function$;

revoke all on function public.reassign_finance_statement_account_v1(uuid,uuid,uuid,text,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.reassign_finance_statement_account_v1(uuid,uuid,uuid,text,uuid) to authenticated;
revoke all on function public.reassign_finance_statement_account_v1(uuid,uuid,uuid,text)
from public,anon,authenticated,service_role;
