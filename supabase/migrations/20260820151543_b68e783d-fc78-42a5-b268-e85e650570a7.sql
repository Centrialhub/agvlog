-- Migration: Monitoramento diário de ICMS para Simples Nacional
-- Localiza CT-es de emissores Simples Nacional com ICMS destacado (diferente de zero).

create or replace function public.monitor_simples_nacional_icms_violations()
returns table (
    fiscal_document_id uuid,
    cte_number text,
    emitter_name text,
    icms_base numeric,
    icms_aliquota numeric,
    icms_valor numeric,
    created_at timestamptz
)
language plpgsql
security definer
  SET search_path = public
set search_path = public
as $$
begin
    return query
    select 
        fd.id as fiscal_document_id,
        fd.document_number as cte_number,
        te.razao_social as emitter_name,
        (fd.payload->'valores'->>'baseIcms')::numeric as icms_base,
        (fd.payload->'valores'->>'aliquotaIcms')::numeric as icms_aliquota,
        (fd.payload->'valores'->>'valorIcms')::numeric as icms_valor,
        fd.created_at
    from 
        public.fiscal_documents fd
    join 
        public.tenant_emitters te on te.id = fd.emitter_id
    where 
        fd.document_type = 'cte'
        and fd.status = 'authorized'
        and (te.regime_tributario = 'simples' or te.regime_tributario = 'mei')
        and (
            (fd.payload->'valores'->>'valorIcms')::numeric > 0
            or (fd.payload->'valores'->>'baseIcms')::numeric > 0
            or (fd.payload->'valores'->>'aliquotaIcms')::numeric > 0
        )
        and fd.deleted_at is null;
end;
$$;

grant execute on function public.monitor_simples_nacional_icms_violations() to authenticated;
grant execute on function public.monitor_simples_nacional_icms_violations() to service_role;
