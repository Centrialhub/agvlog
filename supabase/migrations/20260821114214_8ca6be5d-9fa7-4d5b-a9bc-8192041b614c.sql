CREATE OR REPLACE FUNCTION public.audit_operational_congruence_v1(p_tenant_id uuid)
RETURNS TABLE (
  severity text,
  domain text,
  entity_type text,
  entity_id uuid,
  message text,
  metadata jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id is required';
  END IF;

  IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'not authorized for tenant %', p_tenant_id USING ERRCODE = '42501';
  END IF;

  -- 1) load_items <-> fiscal_documents.load_id divergence
  RETURN QUERY
  SELECT 'error'::text, 'composition'::text, 'load_item'::text, li.id,
         'Item de carga referencia nota fiscal cujo load_id difere da carga do item'::text,
         jsonb_build_object('load_id', li.load_id, 'fiscal_document_id', li.fiscal_document_id,
                            'fiscal_document_load_id', fd.load_id)
  FROM public.load_items li
  JOIN public.fiscal_documents fd ON fd.id = li.fiscal_document_id
  WHERE li.tenant_id = p_tenant_id
    AND li.fiscal_document_id IS NOT NULL
    AND (fd.load_id IS DISTINCT FROM li.load_id);

  RETURN QUERY
  SELECT 'warning'::text, 'composition'::text, 'fiscal_document'::text, fd.id,
         'Nota fiscal aponta para carga sem item de carga correspondente'::text,
         jsonb_build_object('load_id', fd.load_id, 'access_key', fd.access_key)
  FROM public.fiscal_documents fd
  WHERE fd.tenant_id = p_tenant_id
    AND fd.load_id IS NOT NULL
    AND fd.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.load_items li
      WHERE li.load_id = fd.load_id AND li.fiscal_document_id = fd.id
    );

  -- 2) loads.trip_id <-> dispatch_trip_loads
  RETURN QUERY
  SELECT 'error'::text, 'dispatch'::text, 'load'::text, l.id,
         'Carga possui trip_id sem vínculo correspondente em dispatch_trip_loads'::text,
         jsonb_build_object('trip_id', l.trip_id, 'status', l.status)
  FROM public.loads l
  WHERE l.tenant_id = p_tenant_id
    AND l.trip_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.dispatch_trip_loads dtl
      WHERE dtl.load_id = l.id AND dtl.dispatch_trip_id = l.trip_id
    );

  RETURN QUERY
  SELECT 'warning'::text, 'dispatch'::text, 'dispatch_trip_load'::text, dtl.id,
         'Vínculo de despacho existe mas a carga não referencia esta viagem'::text,
         jsonb_build_object('load_id', dtl.load_id, 'dispatch_trip_id', dtl.dispatch_trip_id,
                            'load_trip_id', l.trip_id)
  FROM public.dispatch_trip_loads dtl
  JOIN public.loads l ON l.id = dtl.load_id
  WHERE dtl.tenant_id = p_tenant_id
    AND l.trip_id IS DISTINCT FROM dtl.dispatch_trip_id;

  -- 3) cross-tenant relations
  RETURN QUERY
  SELECT 'critical'::text, 'tenant'::text, 'load_item'::text, li.id,
         'Item de carga em tenant diferente da carga'::text,
         jsonb_build_object('load_id', li.load_id, 'item_tenant_id', li.tenant_id, 'load_tenant_id', l.tenant_id)
  FROM public.load_items li
  JOIN public.loads l ON l.id = li.load_id
  WHERE (li.tenant_id = p_tenant_id OR l.tenant_id = p_tenant_id)
    AND li.tenant_id IS DISTINCT FROM l.tenant_id;

  RETURN QUERY
  SELECT 'critical'::text, 'tenant'::text, 'load_item'::text, li.id,
         'Item de carga referencia nota fiscal de outro tenant'::text,
         jsonb_build_object('fiscal_document_id', fd.id, 'item_tenant_id', li.tenant_id, 'document_tenant_id', fd.tenant_id)
  FROM public.load_items li
  JOIN public.fiscal_documents fd ON fd.id = li.fiscal_document_id
  WHERE (li.tenant_id = p_tenant_id OR fd.tenant_id = p_tenant_id)
    AND li.tenant_id IS DISTINCT FROM fd.tenant_id;

  RETURN QUERY
  SELECT 'critical'::text, 'tenant'::text, 'dispatch_trip_load'::text, dtl.id,
         'Vínculo de despacho cruza tenants entre viagem e carga'::text,
         jsonb_build_object('dispatch_trip_id', dtl.dispatch_trip_id, 'load_id', dtl.load_id,
                            'link_tenant_id', dtl.tenant_id, 'trip_tenant_id', dt.tenant_id, 'load_tenant_id', l.tenant_id)
  FROM public.dispatch_trip_loads dtl
  JOIN public.dispatch_trips dt ON dt.id = dtl.dispatch_trip_id
  JOIN public.loads l ON l.id = dtl.load_id
  WHERE (dtl.tenant_id = p_tenant_id OR dt.tenant_id = p_tenant_id OR l.tenant_id = p_tenant_id)
    AND (dtl.tenant_id IS DISTINCT FROM dt.tenant_id OR dtl.tenant_id IS DISTINCT FROM l.tenant_id);

  RETURN QUERY
  SELECT 'critical'::text, 'tenant'::text, 'dispatch_stop'::text, ds.id,
         'Parada em tenant diferente da viagem'::text,
         jsonb_build_object('dispatch_trip_id', ds.dispatch_trip_id, 'stop_tenant_id', ds.tenant_id, 'trip_tenant_id', dt.tenant_id)
  FROM public.dispatch_stops ds
  JOIN public.dispatch_trips dt ON dt.id = ds.dispatch_trip_id
  WHERE (ds.tenant_id = p_tenant_id OR dt.tenant_id = p_tenant_id)
    AND ds.tenant_id IS DISTINCT FROM dt.tenant_id;

  -- 4) completed trips with non-terminal stops
  RETURN QUERY
  SELECT 'warning'::text, 'dispatch'::text, 'dispatch_trip'::text, dt.id,
         'Viagem concluída/cancelada possui paradas em estado não terminal'::text,
         jsonb_build_object('trip_status', dt.status, 'pending_stops', cnt.pending_stops)
  FROM public.dispatch_trips dt
  JOIN LATERAL (
    SELECT count(*)::int AS pending_stops
    FROM public.dispatch_stops ds
    WHERE ds.dispatch_trip_id = dt.id
      AND coalesce(ds.status, 'pending') NOT IN ('completed', 'delivered', 'cancelled', 'skipped', 'failed')
  ) cnt ON TRUE
  WHERE dt.tenant_id = p_tenant_id
    AND dt.status IN ('completed', 'finished', 'closed', 'cancelled')
    AND cnt.pending_stops > 0;

  -- 5) incoherent dispatch_stop_documents
  RETURN QUERY
  SELECT 'error'::text, 'dispatch'::text, 'dispatch_stop_document'::text, dsd.id,
         'Documento de parada incoerente (tenant, parada ou carga divergentes)'::text,
         jsonb_build_object('dispatch_stop_id', dsd.dispatch_stop_id, 'load_id', dsd.load_id,
                            'fiscal_document_id', dsd.fiscal_document_id,
                            'stop_tenant_id', ds.tenant_id, 'document_tenant_id', fd.tenant_id,
                            'fiscal_document_load_id', fd.load_id)
  FROM public.dispatch_stop_documents dsd
  LEFT JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
  LEFT JOIN public.fiscal_documents fd ON fd.id = dsd.fiscal_document_id
  WHERE dsd.tenant_id = p_tenant_id
    AND (
      ds.id IS NULL
      OR fd.id IS NULL
      OR ds.tenant_id IS DISTINCT FROM dsd.tenant_id
      OR fd.tenant_id IS DISTINCT FROM dsd.tenant_id
      OR (dsd.load_id IS NOT NULL AND fd.load_id IS NOT NULL AND fd.load_id IS DISTINCT FROM dsd.load_id)
    );

  -- 6) load totals vs items
  RETURN QUERY
  SELECT 'warning'::text, 'composition'::text, 'load'::text, l.id,
         'Totais da carga divergem da soma dos itens'::text,
         jsonb_build_object('total_weight_kg', l.total_weight_kg, 'items_weight_kg', agg.weight_kg,
                            'total_volume_m3', l.total_volume_m3, 'items_volume_m3', agg.volume_m3,
                            'item_count', agg.item_count)
  FROM public.loads l
  JOIN LATERAL (
    SELECT coalesce(sum(li.weight_kg), 0)::numeric AS weight_kg,
           coalesce(sum(li.volume_m3), 0)::numeric AS volume_m3,
           count(*)::int AS item_count
    FROM public.load_items li
    WHERE li.load_id = l.id
  ) agg ON TRUE
  WHERE l.tenant_id = p_tenant_id
    AND agg.item_count > 0
    AND (
      abs(coalesce(l.total_weight_kg, 0) - agg.weight_kg) > 0.01
      OR abs(coalesce(l.total_volume_m3, 0) - agg.volume_m3) > 0.001
    );

  -- 7) duplicated access_key (not null, not deleted)
  RETURN QUERY
  SELECT 'error'::text, 'fiscal'::text, 'fiscal_document'::text, fd.id,
         'Chave de acesso duplicada entre notas fiscais ativas'::text,
         jsonb_build_object('access_key', fd.access_key, 'duplicates', d.total)
  FROM public.fiscal_documents fd
  JOIN (
    SELECT access_key, count(*)::int AS total
    FROM public.fiscal_documents
    WHERE tenant_id = p_tenant_id AND access_key IS NOT NULL AND deleted_at IS NULL
    GROUP BY access_key
    HAVING count(*) > 1
  ) d ON d.access_key = fd.access_key
  WHERE fd.tenant_id = p_tenant_id
    AND fd.access_key IS NOT NULL
    AND fd.deleted_at IS NULL;

  -- 8) public tables without RLS
  RETURN QUERY
  SELECT 'critical'::text, 'security'::text, 'table'::text, NULL::uuid,
         format('Tabela pública %s sem RLS habilitado', c.relname)::text,
         jsonb_build_object('schema', 'public', 'table', c.relname)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relrowsecurity = false;

  RETURN;
END;
$fn$;

REVOKE ALL ON FUNCTION public.audit_operational_congruence_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_operational_congruence_v1(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.audit_operational_congruence_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.audit_operational_congruence_v1(uuid) TO service_role;