create function finance_private.native_statement_account(_tenant uuid,_import uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare i public.finance_statement_imports%rowtype;v public.finance_statement_verifications%rowtype;
 account jsonb;native jsonb;registered jsonb;checks jsonb:='[]';field text;file_value text;registered_value text;
 state text:='matched_exact';result jsonb;matching_accounts bigint:=0;
begin
 select * into i from public.finance_statement_imports where tenant_id=_tenant and id=_import;
 if not found then raise exception 'finance_statement_not_found' using errcode='22023';end if;
 select to_jsonb(a) into account from public.bank_accounts a where a.tenant_id=_tenant and a.id=i.bank_account_id;
 if account is null then raise exception 'finance_statement_account_unavailable' using errcode='22023';end if;
 select * into v from public.finance_statement_verifications where tenant_id=_tenant and import_id=_import order by created_at desc,id desc limit 1;
 registered:=jsonb_build_object('bank_code',nullif(btrim(account->>'bank_code'),''),'branch_number',nullif(btrim(account->>'branch_number'),''),
  'account_number',nullif(btrim(account->>'account_number'),''),'account_type',case account->>'account_type' when 'checking' then 'CHECKING' when 'savings' then 'SAVINGS' else null end);
 if i.parser_version<>'native-ofx-v1' then state:='unsupported_format';
 elsif v.id is null or v.outcome<>'rows_match' or v.report->>'hash_verified' is distinct from 'true'
  or v.report->>'actual_hash' is distinct from i.file_hash or v.report->>'identity_trust' is distinct from 'native_file_identifier'
  or v.report#>>'{native_evidence,parser_version}' is distinct from 'native-ofx-v1'
  or v.report#>>'{native_evidence,currency}' is distinct from 'BRL' then state:='source_unverified';
 else
  native:=jsonb_build_object('bank_code',nullif(btrim(v.report#>>'{native_evidence,account,bank_id}'),''),
   'branch_number',nullif(btrim(v.report#>>'{native_evidence,account,branch_id}'),''),'account_number',nullif(btrim(v.report#>>'{native_evidence,account,account_id}'),''),
   'account_type',nullif(btrim(v.report#>>'{native_evidence,account,account_type}'),''));
  foreach field in array array['bank_code','branch_number','account_number','account_type'] loop
   file_value:=native->>field;registered_value:=registered->>field;
   checks:=checks||jsonb_build_array(jsonb_build_object('field',field,'file_value',file_value,'registered_value',registered_value,
    'status',case when file_value is null or registered_value is null then 'missing' when file_value=registered_value then 'matched' else 'different' end));
   if file_value is null or registered_value is null then if state<>'mismatch' then state:='incomplete';end if;
   elsif file_value<>registered_value then state:='mismatch';end if;
  end loop;
  if state='matched_exact' then
   select count(*) into matching_accounts from public.bank_accounts a where a.tenant_id=_tenant
    and nullif(btrim(to_jsonb(a)->>'bank_code'),'')=registered->>'bank_code'
    and nullif(btrim(to_jsonb(a)->>'branch_number'),'')=registered->>'branch_number'
    and nullif(btrim(to_jsonb(a)->>'account_number'),'')=registered->>'account_number'
    and case to_jsonb(a)->>'account_type' when 'checking' then 'CHECKING' when 'savings' then 'SAVINGS' else null end=registered->>'account_type';
   if matching_accounts<>1 then state:='ambiguous';end if;
  end if;
 end if;
 result:=jsonb_build_object('version',1,'tenant_id',_tenant,'import_id',_import,'bank_account_id',i.bank_account_id,'account_name',account->>'name',
  'status',state,'method','ofx_exact_v1','source_verification_id',v.id,'checks',checks,'matching_account_count',matching_accounts,'coverage_verification','pending');
 return result||jsonb_build_object('revision',md5(result::text));
end;$$;
revoke all on function finance_private.native_statement_account(uuid,uuid) from public,anon,authenticated,service_role;
create function finance_private.native_statement_account_as_user(_tenant uuid,_import uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 return finance_private.native_statement_account(_tenant,_import);
end;$$;
create function public.get_finance_native_statement_account(_tenant_id uuid,_import_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.native_statement_account_as_user(_tenant_id,_import_id);$$;
revoke all on function finance_private.native_statement_account_as_user(uuid,uuid),public.get_finance_native_statement_account(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function finance_private.native_statement_account_as_user(uuid,uuid),public.get_finance_native_statement_account(uuid,uuid) to authenticated;
