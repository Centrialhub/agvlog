
Objetivo: estabilizar o fluxo de Integração SSX (login + sync de rastreadores), eliminando erro recorrente no usuário e reduzindo chamadas que estouram limite (429).

1) Diagnóstico confirmado (com base nos logs atuais)
- `ssx-login` está respondendo 200 e gravando token corretamente.
- O problema principal está no `ssx-sync-units`:
  - tenta `TrackedUnit/List` (404),
  - cai para `PositionHistory/List` com janela grande,
  - SSX retorna 429 (limite excedido).
- O `agvlog-pipeline-run` hoje sempre tenta sync de unidades, o que aumenta pressão no rate limit.

2) Plano de implementação (passo a passo)

Passo A — Tornar `ssx-sync-units` resiliente a 429
- Arquivo: `supabase/functions/ssx-sync-units/index.ts`
- Adicionar controle de cooldown por conta (`integration_accounts.settings.sync_units_backoff_until`), sem migration.
- Antes de chamar SSX, verificar se cooldown está ativo:
  - se ativo, retornar 429 com `retry_after_seconds` e mensagem amigável.
- Trocar fallback atual (janela fixa 24h) por fallback progressivo:
  - tentar janelas menores (ex.: 5m → 30m → 6h → 24h), parando no primeiro sucesso.
- Em resposta 429:
  - calcular `backoff_until` (header `Retry-After` quando existir; senão valor padrão),
  - atualizar `integration_accounts.status = 'degraded'` e `last_error`,
  - registrar no `integration_logs` (incluindo janelas tentadas).
- Em sucesso:
  - limpar backoff, setar status `ok`, manter logs de auditoria.

Passo B — Reduzir chamadas desnecessárias no pipeline
- Arquivo: `supabase/functions/agvlog-pipeline-run/index.ts`
- Alterar “Step B Sync units” para ser condicional:
  - rodar apenas se não houver unidades sincronizadas recentemente, ou se não houver `provider_units`.
  - pular quando houver backoff ativo.
- Resultado: polling continua funcionando mesmo quando sync de unidades está temporariamente bloqueado.

Passo C — Melhorar UX no front para erro 429
- Arquivo: `src/pages/Settings.tsx`
- Tratar erro HTTP de edge function lendo payload JSON de erro (não só `e.message`).
- Mostrar toast específico para 429 com tempo de espera.
- Desabilitar botão “Sync Rastreadores” quando houver `sync_units_backoff_until` ativo e exibir “tentar novamente às HH:mm”.

Passo D — Ajuste adicional no login para remover “bugs percebidos”
- Arquivo: `supabase/functions/ssx-login/index.ts`
- Endurecer parser de expiração (`ExpiresIn`) para formatos anômalos (valores absurdos/ticks), com clamp seguro.
- Isso evita TTL “estranho” em log e comportamento inconsistente de validade.

3) Detalhes técnicos (resumo)
- Sem mudanças de schema/migration (usar campo `settings` já existente em `integration_accounts`).
- Fluxo final:
  - Login ok → token cacheado.
  - Sync units respeita cooldown e fallback progressivo.
  - Pipeline não força sync em toda execução.
  - UI comunica claramente quando o bloqueio é rate limit do provedor.

4) Critérios de validação após implementação
- “Testar Login” retorna 200 com `expires_at` consistente.
- “Sync Rastreadores”:
  - em 429: mostra mensagem amigável + horário de nova tentativa;
  - não dispara chamadas repetidas durante cooldown.
- Após cooldown, sync tenta novamente e, quando possível, faz upsert de unidades.
- `integration_logs` mostra metadata completa de tentativas e motivo de falha/sucesso.
