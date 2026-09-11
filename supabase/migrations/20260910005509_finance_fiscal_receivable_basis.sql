create function finance_private.fiscal_cents(_value jsonb) returns bigint
language plpgsql immutable set search_path='' as $$
declare raw text:=_value#>>'{}';amount numeric;
begin
 if jsonb_typeof(_value) not in('number','string') or raw is null or length(raw)>40 or raw !~ '^[0-9]+(\.[0-9]+)?$' then return null;end if;
 amount:=raw::numeric;
 if amount<>trunc(amount,2) or amount>999999999999.99 then return null;end if;
 return (amount*100)::bigint;
end;
$$;
revoke all on function finance_private.fiscal_cents(jsonb) from public,anon,authenticated,service_role;

create function finance_private.fiscal_receivable_basis_internal(_tenant uuid,_observation uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s jsonb;source jsonb;doc_type text;source_id uuid;client uuid;payer uuid;tax text;raw_tax text;matches integer;
 amount bigint;gross bigint;withheld bigint:=0;part bigint;key text;issues text[]:='{}';basis text;
begin
 select snapshot into s from public.finance_fiscal_observations where id=_observation and tenant_id=_tenant;
 if not found then raise exception 'finance_fiscal_observation_not_found' using errcode='22023';end if;
 doc_type:=s->>'doc_type';
 if s->>'environment' is distinct from 'production' or s->>'dispatch_state' is distinct from 'recorded' then issues:=array_append(issues,'unconfirmed_environment');end if;
 if coalesce(s->>'status','') not in('authorized','cancel_rejected') then issues:=array_append(issues,'authorization_not_active');end if;
 if doc_type='cte' then
  source:=case when jsonb_typeof(s->'outbound')='object' then s->'outbound' else s->'cte' end;
  source_id:=nullif(source->>'id','')::uuid;client:=nullif(source->>'client_id','')::uuid;
  raw_tax:=coalesce(nullif(btrim(source->>'payer_cnpj'),''),nullif(btrim(s#>>'{cte,payer_cnpj}'),''));
  tax:=nullif(regexp_replace(coalesce(raw_tax,''),'\D','','g'),'');
  amount:=finance_private.fiscal_cents(source->'freight_value');gross:=amount;basis:='freight';
  if jsonb_typeof(s->'outbound')='object' and jsonb_typeof(s->'cte')='object'
   and finance_private.fiscal_cents(s#>'{outbound,freight_value}') is distinct from finance_private.fiscal_cents(s#>'{cte,freight_value}') then
   issues:=array_append(issues,'cte_amount_conflict');end if;
  if coalesce(s->>'access_key','') !~ '^[0-9]{44}$' or coalesce(s->>'authorization_protocol','') !~ '^[0-9]{15}$' then
   issues:=array_append(issues,'authorization_evidence_missing');end if;
 elsif doc_type='nfse' then
  source:=s->'nfse';source_id:=nullif(source->>'id','')::uuid;client:=nullif(source->>'client_id','')::uuid;
  raw_tax:=coalesce(nullif(btrim(source->>'payer_cnpj'),''),nullif(btrim(source->>'client_cnpj'),''));
  tax:=nullif(regexp_replace(coalesce(raw_tax,''),'\D','','g'),'');
  amount:=finance_private.fiscal_cents(source->'net_amount');gross:=finance_private.fiscal_cents(source->'service_amount');basis:='document_net';
  if source->>'is_preview' is distinct from 'false' then issues:=array_append(issues,'nfse_preview_or_unknown');end if;
  if source->>'iss_withheld' not in('true','false') or source->>'iss_withheld' is null then issues:=array_append(issues,'retention_data_missing');end if;
  foreach key in array array['other_withholdings','pis','cofins','inss','ir','csll'] loop
   part:=finance_private.fiscal_cents(source->key);
   if part is null then issues:=array_append(issues,'retention_data_missing');else withheld:=withheld+part;end if;
  end loop;
  if source->>'iss_withheld'='true' then
   part:=finance_private.fiscal_cents(source->'iss_amount');
   if part is null then issues:=array_append(issues,'retention_data_missing');else withheld:=withheld+part;end if;
  end if;
  if gross is null or amount is null or amount>gross or gross-amount<>withheld then issues:=array_append(issues,'nfse_net_amount_conflict');end if;
  if nullif(btrim(s->>'number'),'') is null or nullif(btrim(s->>'authorization_protocol'),'') is null then issues:=array_append(issues,'authorization_evidence_missing');end if;
 else issues:=array_append(issues,'unsupported_fiscal_type');end if;
 if source_id is null then issues:=array_append(issues,'fiscal_source_missing');end if;
 if amount is null or amount<=0 then issues:=array_append(issues,'invalid_receivable_amount');end if;
 if raw_tax is not null and tax is null then issues:=array_append(issues,'invalid_payer_document');end if;
 if tax is not null then
  if length(tax) not in(11,14) then issues:=array_append(issues,'invalid_payer_document');
  else
   select count(*),(array_agg(c.id order by c.id))[1] into matches,payer from public.clients c
    where c.tenant_id=_tenant and c.active and regexp_replace(coalesce(c.tax_id,''),'\D','','g')=tax;
   if matches<>1 then payer:=null;issues:=array_append(issues,case when matches=0 then 'payer_not_registered' else 'payer_document_ambiguous' end);end if;
  end if;
 else
  select c.id into payer from public.clients c where c.tenant_id=_tenant and c.id=client and c.active;
  if payer is null then issues:=array_append(issues,'payer_missing');end if;
 end if;
 select coalesce(array_agg(distinct value order by value),'{}') into issues from unnest(issues) value;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'observation_id',_observation,'doc_type',doc_type,
  'source_id',source_id,'customer_id',client,'payer_id',payer,'payer_document',tax,'amount_basis',basis,
  'amount_cents',amount::text,'gross_cents',gross::text,'withheld_cents',withheld::text,
  'ready',cardinality(issues)=0,'issues',to_jsonb(issues));
end;
$$;
revoke all on function finance_private.fiscal_receivable_basis_internal(uuid,uuid) from public,anon,authenticated,service_role;
create function public.get_finance_fiscal_receivable_basis(_tenant_id uuid,_observation_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if not finance_private.can_access(_tenant_id) then raise exception 'finance_access_denied' using errcode='42501';end if;
 return finance_private.fiscal_receivable_basis(_tenant_id,_observation_id);
end;
$$;
revoke all on function public.get_finance_fiscal_receivable_basis(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_fiscal_receivable_basis(uuid,uuid) to authenticated;
-- Private entry is also permission checked because the public adapter is invoker.
create function finance_private.fiscal_receivable_basis(_tenant uuid,_observation uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 return finance_private.fiscal_receivable_basis_internal(_tenant,_observation);
end;$$;
revoke all on function finance_private.fiscal_receivable_basis(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function finance_private.fiscal_receivable_basis(uuid,uuid) to authenticated;
