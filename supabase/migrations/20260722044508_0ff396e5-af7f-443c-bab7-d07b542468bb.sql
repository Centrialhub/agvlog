
-- 1) Colunas de hold em loads
ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS on_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hold_reason text NULL,
  ADD COLUMN IF NOT EXISTS held_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS held_by uuid NULL;

CREATE INDEX IF NOT EXISTS loads_on_hold_idx
  ON public.loads (tenant_id) WHERE on_hold = true;

-- 2) RPC: colocar carga em espera
CREATE OR REPLACE FUNCTION public.hold_load(_load_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_prev boolean;
BEGIN
  SELECT tenant_id, on_hold INTO v_tenant, v_prev
    FROM public.loads WHERE id = _load_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Carga não encontrada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_memberships
     WHERE user_id = auth.uid() AND tenant_id = v_tenant
       AND active = true AND role IN ('owner','admin','operator')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para pausar cargas';
  END IF;

  UPDATE public.loads
     SET on_hold = true,
         hold_reason = NULLIF(btrim(_reason), ''),
         held_at = now(),
         held_by = auth.uid(),
         updated_at = now()
   WHERE id = _load_id;

  IF v_prev IS DISTINCT FROM true THEN
    INSERT INTO public.load_status_history
      (tenant_id, load_id, field_name, old_value, new_value, reason, created_by)
    VALUES
      (v_tenant, _load_id, 'on_hold', 'false', 'true', NULLIF(btrim(_reason), ''), auth.uid());
  END IF;
END;
$$;

-- 3) RPC: retirar carga da espera
CREATE OR REPLACE FUNCTION public.unhold_load(_load_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_prev boolean;
BEGIN
  SELECT tenant_id, on_hold INTO v_tenant, v_prev
    FROM public.loads WHERE id = _load_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Carga não encontrada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_memberships
     WHERE user_id = auth.uid() AND tenant_id = v_tenant
       AND active = true AND role IN ('owner','admin','operator')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para retomar cargas';
  END IF;

  UPDATE public.loads
     SET on_hold = false,
         hold_reason = NULL,
         held_at = NULL,
         held_by = NULL,
         updated_at = now()
   WHERE id = _load_id;

  IF v_prev IS DISTINCT FROM false THEN
    INSERT INTO public.load_status_history
      (tenant_id, load_id, field_name, old_value, new_value, reason, created_by)
    VALUES
      (v_tenant, _load_id, 'on_hold', 'true', 'false', NULL, auth.uid());
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hold_load(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unhold_load(uuid) TO authenticated;

-- 4) Excluir cargas em espera da visão do motorista
CREATE OR REPLACE FUNCTION public._driver_load_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
  SET search_path = public
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT dtl.load_id FROM public.dispatch_trip_loads dtl
  JOIN public.dispatch_trips dt ON dt.id = dtl.dispatch_trip_id
  JOIN public.drivers d ON d.id = dt.driver_id
  JOIN public.loads l ON l.id = dtl.load_id
  WHERE d.user_id = auth.uid() AND d.active = true AND l.on_hold = false
  UNION
  SELECT l.id FROM public.loads l
  JOIN public.dispatch_trips dt ON dt.id = l.trip_id
  JOIN public.drivers d ON d.id = dt.driver_id
  WHERE d.user_id = auth.uid() AND d.active = true AND l.on_hold = false
  UNION
  SELECT l.id FROM public.loads l
  JOIN public.drivers d ON d.id = l.driver_id
  WHERE d.user_id = auth.uid() AND d.active = true AND l.on_hold = false;
$function$;
