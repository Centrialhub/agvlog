-- Limpar todas as NF-es e dados logísticos relacionados para reiniciar
-- Ordem importante por causa das FKs

-- 1. Eventos de despacho
DELETE FROM public.dispatch_events;

-- 2. Paradas de despacho
DELETE FROM public.dispatch_stops;

-- 3. Viagens de despacho
DELETE FROM public.dispatch_trips;

-- 4. Itens de carga
DELETE FROM public.load_items;

-- 5. Documentos fiscais (NF-es)
DELETE FROM public.fiscal_documents;

-- 6. Cargas
DELETE FROM public.loads;

-- 7. Logs de cálculo de frete (opcional, mas ajuda a limpar)
DELETE FROM public.freight_calculation_log;

-- 8. Rascunhos de planejamento de rota
DELETE FROM public.route_planning_drafts;