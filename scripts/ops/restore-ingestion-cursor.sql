-- Ops runbook (NÃO é migration, NÃO roda automaticamente).
-- Reativa os cursores de ingestão de um tenant, forçando o próximo poll.
--
-- Uso:
--   psql "$DATABASE_URL" -v tenant_id="'<uuid-do-tenant>'" \
--        -f scripts/ops/restore-ingestion-cursor.sql
--
-- Requisitos: executar com service_role/superuser, fora do histórico de
-- migrations. Ver docs/schema-recovery-2026-08-21.md.

\if :{?tenant_id}
\else
  \echo 'ERRO: informe -v tenant_id="'"'"'<uuid>'"'"'"'
  \quit
\endif

BEGIN;

UPDATE public.ingestion_cursors
SET last_polled_at = NOW() - interval '1 hour'
WHERE tenant_id = (:tenant_id)::uuid;

-- Confira o resultado antes de confirmar.
SELECT tenant_id, last_polled_at
FROM public.ingestion_cursors
WHERE tenant_id = (:tenant_id)::uuid;

COMMIT;
