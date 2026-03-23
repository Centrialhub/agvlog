

# Diagnóstico: Por que o status dos veículos está errado

## Dados reais agora

| Veículo | received_at (min) | speed | speed_source | movement_state |
|---------|------------------|-------|-------------|----------------|
| OPW7913 | 0.7 | 0 | computed | stopped |
| GVJ3719 | 6.7 | null | null | null |
| GVJ3744 | 6.7 | null | null | null |
| PVM3834 | 9.7 | null | null | null |
| HDO5276 | 12.6 | null | null | null |
| GVJ2074 | 156 | null | null | null |
| GVJ3909 | 303 | null | null | null |

**Apenas 1 de 16 veículos recebeu o cálculo de velocidade** (OPW7913). Os outros 15 têm `speed=null` e `movement_state=null`.

## Causa raiz

O código de cálculo de velocidade (haversine) no `ssx-poll-positions` só roda quando uma **nova posição com coordenadas diferentes** é inserida. Mas na maioria dos pollings:
- O veículo está parado → SSX retorna a mesma posição ou nenhuma posição nova
- O código faz apenas heartbeat (atualiza `received_at`) sem recalcular speed
- Resultado: `speed` e `movement_state` ficam `null` para sempre

## Solução proposta

Mover a lógica de status para ser **sempre calculada** no upsert de `positions_last`, não apenas quando há nova posição:

### 1. Backend: Sempre computar speed no upsert de positions_last

No `ssx-poll-positions`, em TODOS os caminhos que fazem upsert/update de `positions_last` (incluindo heartbeat):
- Se há nova posição com coordenadas diferentes → calcular speed via haversine (já existe)
- Se há nova posição com coordenadas iguais (< 50m) → `speed = 0, movement_state = "stopped"`
- Se é heartbeat (sem nova posição) → manter speed anterior mas atualizar `movement_state` para `"stopped"` (se speed era 0 ou null) e garantir que `speed` não fique null (defaultar para 0)

### 2. Backend: Patch de inicialização

Para os 15 veículos que já têm `speed=null`, executar um UPDATE em `positions_last` setando `speed=0` e `source.movement_state="stopped"` e `source.speed_source="inferred"` para todos que têm `speed IS NULL`. Isso corrige o estado atual imediatamente.

### 3. Frontend: Tratar speed null como 0 (parado)

No `getVehicleStatus`, tratar `speed == null` como `speed = 0` (parado). Isso é semanticamente correto: se não temos evidência de movimento, o veículo está parado.

## Arquivos a alterar

| Arquivo | Alteração |
|---------|-----------|
| `supabase/functions/ssx-poll-positions/index.ts` | Garantir que speed e movement_state são sempre preenchidos em todos os caminhos de upsert (nova posição, mesma posição, heartbeat) |
| `src/pages/FleetMap.tsx` | `speed == null` → tratar como 0 (parado), usar `source.movement_state` como indicador primário |
| Migration SQL | UPDATE positions_last SET speed=0, source=jsonb_set(...) WHERE speed IS NULL — patch retroativo |

## Resultado esperado

- Veículos com polling ativo (received_at < 15 min) e parados → "Parado" (amarelo) com speed=0
- Veículos com polling ativo e em movimento → "Movendo" (verde) com speed calculada
- Veículos sem polling recente → "Offline" (cinza)
- Nenhum veículo com speed=null — sempre preenchido

