
CREATE OR REPLACE FUNCTION public.delete_driver_settlement(
  _settlement_id uuid,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s public.driver_settlements;
BEGIN
  -- 1. Obter e validar acerto
  SELECT * INTO v_s FROM public.driver_settlements WHERE id = _settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  -- 2. Verificar permissão de tenant
  IF NOT public.is_tenant_operator_or_admin(v_s.tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- 3. Verificar status
  IF v_s.status IN ('paid', 'closed') AND NOT public.is_tenant_admin(v_s.tenant_id) THEN
    RAISE EXCEPTION 'cannot_delete_settled_record';
  END IF;

  -- 4. Desvincular romaneios (loads)
  UPDATE public.loads
  SET driver_settlement_id = NULL
  WHERE driver_settlement_id = _settlement_id;

  -- 5. Remover dependências
  DELETE FROM public.driver_settlement_items WHERE settlement_id = _settlement_id;
  DELETE FROM public.driver_settlement_events WHERE settlement_id = _settlement_id;
  DELETE FROM public.driver_settlement_payments WHERE settlement_id = _settlement_id;

  -- 6. Remover o registro principal
  DELETE FROM public.driver_settlements WHERE id = _settlement_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_driver_settlement(uuid, text) TO authenticated;
