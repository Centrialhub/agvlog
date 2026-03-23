

# Corrigir: 8 unidades falhando no discovery + status incorreto no frontend

## Problema 1: 8 unidades com "No combination returned positions"

A invalidação do memo (v8) forçou rediscovery, mas para metade das unidades o discovery falha — provavelmente porque o `IdTrackedUnit` salvo no metadata está errado ou ausente para essas unidades.

**Diagnóstico necessário**: Verificar o metadata dessas 8 unidades para ver se têm `id_tracked_unit` válido.

**Correção no `ssx-poll-positions`**:
- Se o Stage 1 (memo) e Stage 2 (discovery) falharem, adicionar um **Stage 3: Broadband fallback** — fazer uma chamada PositionHistory SEM filtro de unidade (janela curta de 30 min), e no resultado, procurar posições que correspondam à unidade pelo campo `TrackedUnit`/`Plate`. Se encontrar, extrair o `IdTrackedUnit` correto do payload e salvar no memo.
- Isso resolve o bootstrap: uma vez que o `IdTrackedUnit` correto é descoberto via broadband, o memo passa a funcionar.

## Problema 2: Frontend classifica "parado com polling ativo" como "stale"

O `getVehicleStatus` no FleetMap usa `max(captured_at, received_at)` via `getFreshnessTimestamp`. Mas olhando os dados:
- HDO5276: `captured_at` = 11:01, `received_at` = 12:36 (3 min atrás) → deveria ser "Parado"
- HFB4G43: `captured_at` = 19:13 (3 dias!), `received_at` = 12:21 (19 min) → deveria ser "Parado" ou "Offline recente"

O threshold de 25 min para ONLINE deveria funcionar para HDO5276 (received_at 3 min ago). O problema pode ser que o frontend não está recebendo `received_at` na query.

**Correção no `usePositions.tsx`**: Verificar que `received_at` está sendo selecionado na query (`select('*')` — deveria estar OK). Verificar se o tipo `PositionLast` inclui `received_at`.

**Correção no `FleetMap.tsx`**: Já usa `getFreshnessTimestamp(captured_at, received_at)` — preciso verificar se `received_at` realmente chega ao componente.

## Arquivos a alterar

| Arquivo | Alteração |
|---------|-----------|
| `supabase/functions/ssx-poll-positions/index.ts` | Adicionar Stage 3 broadband fallback para descobrir IdTrackedUnit correto quando discovery falha |
| `src/pages/FleetMap.tsx` | Verificar e corrigir uso de received_at no status (pode não estar chegando) |
| `src/hooks/usePositions.tsx` | Verificar que received_at está no select e no tipo |

## Resultado esperado

- As 8 unidades que falham passam a descobrir seu IdTrackedUnit via broadband e começam a funcionar
- Veículos parados com polling ativo aparecem como "Parado" (amarelo) ao invés de "Posição antiga" (cinza)
- Ciclo completo de atualização da frota: ~24 min (todos os 16 veículos)

