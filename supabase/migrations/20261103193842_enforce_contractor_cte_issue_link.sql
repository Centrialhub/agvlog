-- Incremental guard only; existing preparation/reservation RPC and ACLs are unchanged.
create function contractor_cte_private.guard_issue_source_v1()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  p jsonb := new.cte_payload;
  b jsonb := p->'payload';
  s public.contractor_cte_sources%rowtype;
  d jsonb;
  n jsonb;
begin
  if tg_op='UPDATE' and old.cte_payload->'payload'->>'tipoServico'='1' then
    if new.cte_payload is distinct from old.cte_payload or new.tenant_id is distinct from old.tenant_id
      or new.emitter_id is distinct from old.emitter_id or new.document_type is distinct from old.document_type then
      raise exception 'contractor_cte_snapshot_immutable' using errcode='23514';
    end if;
    return new;
  end if;
  if coalesce(b->>'tipoServico','0')<>'1' then
    if p ? 'contractorCteSource' or b ? 'documentoAnterior' then
      raise exception 'contractor_cte_service_required' using errcode='23514';
    end if;
    return new;
  end if;
  if new.document_type<>'outbound' or b->>'tipoCtrc' is distinct from '01'
    or jsonb_typeof(p->'contractorCteSource') is distinct from 'object'
    or coalesce(p->'contractorCteSource'->>'id','') !~ '^[a-f0-9-]{36}$' then
    raise exception 'contractor_cte_snapshot_invalid' using errcode='23514';
  end if;
  select * into s from public.contractor_cte_sources
    where id=(p->'contractorCteSource'->>'id')::uuid and tenant_id=new.tenant_id;
  if not found or s.original_sha256 is distinct from p->'contractorCteSource'->>'sha256'
    or s.environment is distinct from (case when p->>'environment'='production' then 'production' when p->>'environment' in ('homologation','sandbox') then 'homologation' else null end) then
    raise exception 'contractor_cte_source_unavailable' using errcode='23514';
  end if;
  d:=s.document;
  -- The immutable source already has the model/check-digit table constraint.
  if substr(s.access_key,7,14) is distinct from d->>'issuer_cnpj'
    or regexp_replace(p->>'emitterCnpj','\D','','g') is not distinct from d->>'issuer_cnpj'
    or b->'documentoAnterior' is distinct from jsonb_build_object(
      'chave',s.access_key,'cnpj',d->>'issuer_cnpj','nome',d->>'issuer_name',
      'ie',upper(regexp_replace(d->>'issuer_ie','[^0-9A-Za-z]','','g')),'uf',d->>'issuer_state',
      'municipioInicio',d->>'origin_city_code','municipioFim',d->>'destination_city_code')
    or b->'tomador'->>'cnpj' is distinct from d->>'issuer_cnpj'
    or b->'tomador'->>'role' is distinct from 'terceiro'
    or b->'inicio'->>'codigoCidade' is distinct from d->>'origin_city_code'
    or b->'fim'->>'codigoCidade' is distinct from d->>'destination_city_code'
    or nullif(b->'inicio'->>'municipio','') is null or nullif(b->'fim'->>'municipio','') is null then
    raise exception 'contractor_cte_source_mismatch' using errcode='23514';
  end if;
  if jsonb_typeof(b->'notasFiscais') is distinct from 'array' or jsonb_array_length(b->'notasFiscais')=0 then
    raise exception 'contractor_cte_invoices_required' using errcode='23514';
  end if;
  if jsonb_array_length(d->'referenced_nfe_keys')>0 then
    for n in select value from jsonb_array_elements(b->'notasFiscais') loop
      if not (d->'referenced_nfe_keys' ? coalesce(n->>'chave','')) then
        raise exception 'contractor_cte_invoice_mismatch' using errcode='23514';
      end if;
    end loop;
  end if;
  return new;
end $$;
revoke all on function contractor_cte_private.guard_issue_source_v1() from public,anon,authenticated,service_role;
create trigger contractor_cte_issue_source_v1
before insert or update of cte_payload,tenant_id,emitter_id,document_type on public.fiscal_documents
for each row execute function contractor_cte_private.guard_issue_source_v1();
