# Guardrail Exceptions

Este arquivo registra exceções permitidas pelos guardrails automáticos de integridade.
Toda entrada deve conter uma justificativa técnica clara.

## Escrita Direta no Frontend (SoT Bypass)
*Nenhuma exceção registrada.*

## SECURITY DEFINER sem search_path
- `20260707182042...sql`: Migração histórica de fundação financeira.
- `20260813193538...sql`: Função legada de processamento.
- `20260813202445...sql`: RPC histórico de faturamento.
- `20260813202846...sql`: RPC histórico de faturamento (ajuste).
- `20260813204000...sql`: Fix histórico de cleanup de cargas.

## DML sem tenant_id
- `20260309182129...sql`: Cleanup de sistema global (admin).
- `20260309182511...sql`: Setup de parâmetros iniciais.
- `20260312144618...sql`: Configuração histórica de auditoria.
- `20260323203909...sql`: Configuração histórica de RLS/Auth.
- `20260406155309...sql`: Patch histórico de telemetria.
- `20260415181652...sql`: Reset de ambiente legado.
- `20260415195748...sql`: Reset de ambiente legado (fiscal).
- `20260415205657...sql`: Reset de ambiente legado (fiscal rascunhos).
- `20260416022445...sql`: Reset completo de ambiente operacional.
- `20260416190448...sql`: Reset profundo de documentos fiscais e logs.
- `20260416191748...sql`: Cleanup de documentos fiscais e dependências (load_items).
- `20260416202458...sql`: Reset operacional profundo (todas as entidades canônicas).
- `20260416203001...sql`: Reset operacional profundo (ajuste).
- `20260416203803...sql`: Reset operacional profundo (final).
- `20260422181812...sql`: Reset operacional profundo (post-ingestion).
- `20260422193725...sql`: Reset operacional profundo (ajuste final).
- `20260508194926...sql`: Reset profundo para congruência de motoristas.
- `20260513205838...sql`: Reset operacional legado de romaneios.

## RLS Bypass
- `profiles`: Necessário para consulta de metadados públicos do usuário durante o login.
