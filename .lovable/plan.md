

# Reduzir impacto dos 429 do SSX

## Problema raiz

O `ssx-sync-units` faz **até 6 chamadas HTTP ao SSX** em sequência (2x TrackedUnit/List + até 4x PositionHistory com janelas progressivas). Como o TrackedUnit/List sempre retorna 404, toda sync queima 2 chamadas antes de tentar o fallback, que por sua vez tenta múltiplas janelas. Isso esgota o rate limit rapidamente.

## Plano

### 1. Memorizar o endpoint que funciona (`ssx-sync-units`)

Salvar em `integration_accounts.settings` o campo `last_successful_endpoint` e `last_successful_format` quando um sync funciona. Na próxima execução, tentar esse endpoint/formato **primeiro**, pulando os que já falharam com 404.

Isso reduz de 6 chamadas para **1 chamada** no caso normal (endpoint já conhecido).

### 2. Parar imediatamente ao receber 429 no fallback

Hoje, se TrackedUnit/List retorna 429, o código para. Mas se retorna 404 e PositionHistory retorna 429, o loop continua tentando janelas maiores. Corrigir para abortar o loop inteiro no primeiro 429 recebido (já implementado corretamente no código atual -- confirmo que está ok).

### 3. Cache local de unidades -- pular sync se recente

No `ssx-sync-units`, antes de chamar SSX, verificar `settings.last_units_sync_at`. Se foi há menos de 1 hora, retornar sucesso imediato com `skipped: true`. Isso evita chamadas SSX completamente durante uso normal.

### 4. Backoff exponencial em vez de fixo 5 min

Trocar o backoff fixo de 5 minutos por exponencial: 2min → 5min → 15min → 30min (máximo). Gravar `sync_units_backoff_count` no settings. Resetar para 0 em sucesso. Isso dá mais chances de recuperação rápida quando o 429 é transitório.

### 5. UI: botão "Forçar Sync" com override de cache (não do backoff)

Permitir que o usuário force um sync ignorando o cache de 1h, mas **respeitando** o backoff do 429. Adicionar flag `force` no payload.

## Arquivos alterados

- `supabase/functions/ssx-sync-units/index.ts` -- endpoint caching, time-based skip, exponential backoff
- `src/pages/Settings.tsx` -- botão "Forçar Sync" e exibição de info de cache

## Resultado esperado

- Caso normal (unidades já conhecidas): **0 chamadas ao SSX**
- Primeiro sync ou forçado: **1 chamada** (endpoint memorizado)
- Após 429: backoff começa em 2min em vez de 5min, escalando se persistir

