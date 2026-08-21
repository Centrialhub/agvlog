-- Restaura a visibilidade dos dados de faturamento/operacao concedendo os
-- privilegios de leitura ausentes ao papel autenticado.
--
-- NOTA DE HISTORICO: esta migration continha um UPDATE em
-- public.ingestion_cursors com tenant_id fixo (mutacao de ambiente). Isso nao
-- pertence ao historico reutilizavel e foi movido para
-- scripts/ops/restore-ingestion-cursor.sql (parametrizado por tenant_id, sem
-- execucao automatica). Ver docs/schema-recovery-2026-08-21.md.

GRANT SELECT ON public.vw_load_control TO authenticated;
GRANT SELECT ON public.vw_operational_workspace TO authenticated;
GRANT SELECT ON public.vehicles_state TO authenticated;
