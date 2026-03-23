

# Plano: Status e velocidade baseados em delta entre pollings

## Problema atual

- SSX raramente retorna `speed` (campo geralmente null)
- `getVehicleStatus()` no FleetMap usa `speed > 2` para classificar "movendo" vs "parado", mas como speed é null, quase tudo aparece como "parado"
- Não há cálculo de velocidade estimada a partir da distância entre posições consecutivas

## Solução

Calcular velocidade e status no backend (`ssx-poll-positions`) comparando a posição nova com a posição anterior em `positions_last`, e armazenar o resultado.

### 1. Backend: Calcular velocidade estimada no polling

No `ssx-poll-positions`, antes de fazer upsert em `positions_last`:
- Buscar a posição atual do veículo em `positions_last` (lat, lng, captured_at) — já é feito parcialmente
- Calcular distância (haversine) entre posição antiga e nova
- Calcular tempo decorrido entre `captured_at` antigo e novo
- Se distância < 50m → veículo parado, speed = 0
- Se distância >= 50m → speed = (distância / tempo) em km/h
- Armazenar `speed` calculado no upsert de `positions_last` (sobrescrevendo o null da SSX)
- Adicionar `source.speed_source = "computed"` ou `"provider"` para rastreabilidade

### 2. Backend: Enriquecer telemetry_snapshot com estado derivado

No upsert de `positions_last`, adicionar ao `source`:
- `movement_state`: `"moving"` | `"stopped"` | `"idle"` (parado < 50m mas com ignição, se disponível)
- `distance_from_previous_m`: distância em metros desde última posição
- `time_since_previous_s`: segundos desde última posição

### 3. Frontend: Simplificar getVehicleStatus

A lógica no FleetMap já funciona (`speed > 2` → moving). Com speed sempre preenchido pelo backend, o status passa a funcionar corretamente sem mudanças estruturais. Ajustes mínimos:
- Usar threshold de 3 km/h (50m em ~60s) como limiar de movimento
- Mostrar velocidade estimada na sidebar mesmo quando a fonte é "computed"

### 4. Heartbeat: Veículo parado com polling ativo

Quando o polling retorna "no new data" (heartbeat), manter o speed anterior e atualizar apenas `received_at`. O status permanece como "Parado" (speed = 0 ou baixa) com sinal recente.

## Arquivos a alterar

| Arquivo | Alteração |
|---------|-----------|
| `supabase/functions/ssx-poll-positions/index.ts` | Buscar posição anterior, calcular speed via haversine, incluir no upsert |
| `src/pages/FleetMap.tsx` | Ajustar threshold de speed para 3 km/h, mostrar "Velocidade estimada" quando source é computed |

## Resultado esperado

- Veículos em movimento mostram velocidade estimada real (ex: 45 km/h)
- Veículos parados mostram 0 km/h e status "Parado" (amarelo)
- Veículos sem polling recente mostram "Offline" (cinza)
- Velocidade sempre preenchida, nunca null

