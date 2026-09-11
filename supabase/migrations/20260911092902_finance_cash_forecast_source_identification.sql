-- Descriptive current identification only; original monetary facts and snapshot hashes are unchanged.
set lock_timeout='3s';set statement_timeout='30s';
do $guard$declare p record;begin
 select * into p from pg_proc where oid=to_regprocedure('finance_private.public_cash_forecast_sources(uuid,date,date,uuid,text,integer,text)');
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from 'c8e8f39cee556d3082c8976326c665f2' or not p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[]
 or not has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') then raise exception 'finance_forecast_identification_predecessor_changed' using errcode='55000';end if;
end$guard$;
create function finance_private.cash_forecast_identified_sources(t uuid,_page jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item jsonb;rows jsonb:='[]';data jsonb;party text;label text;description text;document text;origin_id uuid;
begin
 perform finance_private.require_access(t);
 if _page->>'tenant_id' is distinct from t::text or _page->>'actor_id' is distinct from auth.uid()::text or jsonb_typeof(_page->'rows') is distinct from 'array' or jsonb_array_length(_page->'rows')>30 then raise exception 'finance_forecast_identification_scope_invalid' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(_page->'rows') loop
  data:=null;party:=null;label:=null;description:=null;document:=null;
  if _page->>'kind'='origins' then
   origin_id:=(item->>'source_id')::uuid;
   if item->>'source_table'='payables' then
    select to_jsonb(p) into data from public.payables p where p.tenant_id=t and p.id=origin_id;
    party:=data->>'supplier_name';description:=data->>'description';document:=data->>'document_number';label:='Conta a pagar';
   elsif item->>'source_table'='receivables' then
    select to_jsonb(r),c.company_name into data,party from public.receivables r left join public.clients c on c.tenant_id=t and c.id=r.client_id where r.tenant_id=t and r.id=origin_id;
    description:=data->>'description';document:=data->>'invoice_number';label:='Conta a receber';
   elsif item->>'source_table' in('fiscal_documents','delivery_attempts') then
    select to_jsonb(f),c.company_name into data,party from public.fiscal_documents f left join public.clients c on c.tenant_id=t and c.id=f.client_id where f.tenant_id=t and (item->>'source_table'='fiscal_documents' and f.id=origin_id or item->>'source_table'='delivery_attempts' and exists(select 1 from public.delivery_attempts d where d.tenant_id=t and d.id=origin_id and d.fiscal_document_id=f.id));
    description:=data->>'product_summary';document:=data->>'invoice_number';label:='Frete a faturar';
   end if;
  elsif _page->>'kind'='movements' then
   select to_jsonb(m),a.name into data,label from public.finance_movements m left join public.bank_accounts a on a.tenant_id=t and a.id=m.bank_account_id where m.tenant_id=t and m.id=(item->>'movement_id')::uuid;
   party:=data->>'beneficiary_name';description:=data->>'description';
  elsif _page->>'kind'='credits' then
   select c.company_name into party from public.clients c where c.tenant_id=t and c.id=(item->>'payer_id')::uuid;label:='Crédito de cliente';
  end if;
  if _page->>'kind'<>'issues' then item:=item||jsonb_build_object('display',jsonb_build_object('basis','current_identification','label',label,'party_name',party,'description',description,'document_number',document));end if;
  rows:=rows||jsonb_build_array(item);
 end loop;
 return jsonb_set(_page,'{rows}',rows);
end$$;
revoke all on function finance_private.cash_forecast_identified_sources(uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function finance_private.public_cash_forecast_sources(_tenant_id uuid,_cutoff date,_period_end date,_snapshot_id uuid,_kind text,_page integer,_expected_revision text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform finance_private.require_access(_tenant_id);
 return finance_private.cash_forecast_identified_sources(_tenant_id,finance_private.cash_forecast_source_page(_tenant_id,_cutoff,_period_end,_snapshot_id,_kind,_page,_expected_revision));
end$$;
revoke all on function finance_private.public_cash_forecast_sources(uuid,date,date,uuid,text,integer,text) from public,anon,service_role;
grant execute on function finance_private.public_cash_forecast_sources(uuid,date,date,uuid,text,integer,text) to authenticated;
