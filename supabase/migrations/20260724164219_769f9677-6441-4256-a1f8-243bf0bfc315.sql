CREATE OR REPLACE FUNCTION public.cte_defaults_for_group(
  _tenant_id uuid,
  _load_ids uuid[],
  _fiscal_document_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emitter_row public.tenant_emitters%ROWTYPE;
  result jsonb;
BEGIN
  -- Fix: coluna correta é "active", não "is_active"
  SELECT * INTO emitter_row
  FROM public.tenant_emitters e
  WHERE e.tenant_id = _tenant_id
    AND e.active = true
  ORDER BY e.is_default DESC NULLS LAST, e.created_at ASC
  LIMIT 1;

  result := jsonb_build_object(
    'emitter', CASE WHEN emitter_row.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', emitter_row.id,
      'cnpj', emitter_row.cnpj,
      'ie', emitter_row.ie,
      'razao_social', emitter_row.razao_social,
      'nome_fantasia', emitter_row.nome_fantasia,
      'endereco', emitter_row.endereco,
      'city_code', emitter_row.city_code,
      'regime_tributario', emitter_row.regime_tributario
    ) END
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cte_defaults_for_group(uuid, uuid[], uuid[]) TO authenticated, service_role;