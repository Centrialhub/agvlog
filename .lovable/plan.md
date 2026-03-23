

# Plano: Polling de toda a frota a cada ciclo

## Situação atual

- `BATCH_SIZE = 3`, `maxBatchesPerRun = 2` (modo poll) → 6 unidades por ciclo de 3 min
- 16 unidades → ciclo completo = ~24 min
- Unidades paradas fazem 1 request SSX e retornam em <1s
- Unidades em discovery fazem até 8+ requests (lento)

## Mudança proposta

No `agvlog-pipeline-run`, remover o limite de batches no modo poll. Em vez disso, confiar no mecanismo de abort existente (429 / timeout / persistence_failure) para interromper naturalmente quando necessário.

| Arquivo | Alteração |
|---------|-----------|
| `supabase/functions/agvlog-pipeline-run/index.ts` | `maxBatchesPerRun` = `Infinity` para modo poll (igual full/manual). Manter `BATCH_SIZE = 3` para manter sub-lotes pequenos por chamada de edge function. |

## Por que é seguro

- Unidades com memo válido + paradas = 1 request SSX, ~200ms. Não contribuem para rate limit de forma relevante.
- O sistema já aborta o batch inteiro ao receber 429, persistence_failure ou timeout.
- O `BATCH_SIZE = 3` por chamada de edge function garante que cada invocação individual não estoura o CPU time limit.
- O fairness sort continua: unidades menos recentes são processadas primeiro.

## Resultado esperado

- Toda a frota atualizada a cada ciclo de 3 min (em vez de 24 min)
- Se a SSX retornar 429 no meio, o sistema para naturalmente e retoma no próximo ciclo
- Heartbeat (`received_at`) atualizado para todos os veículos a cada 3 min → todos aparecem como "Parado" ou "Online" no frontend

