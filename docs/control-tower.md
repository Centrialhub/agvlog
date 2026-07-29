# Torre de Controle Operacional (`/operations-control`)

Painel em tempo real com mapa, KPIs, alertas e detalhes por viagem, baseado em OSRM.

## OSRM

Por padrão o sistema usa o servidor público de demonstração (`https://router.project-osrm.org`).
Esse servidor é compartilhado e tem limites — em produção configure um OSRM self-hosted.

Para apontar para seu OSRM:

1. Configure o secret `OSRM_BASE_URL` no Supabase (`Settings → Functions → Secrets`).
   Exemplo: `https://osrm.seudominio.com` (sem barra no final).
2. As Edge Functions `calculate-trip-route` e `update-trip-live-status` passam a usar essa URL.
3. Se um dia precisar usar a URL também no frontend, defina `VITE_OSRM_BASE_URL` no `.env`.

Endpoint usado:
```
{OSRM_BASE_URL}/route/v1/driving/{lng,lat};{lng,lat};...?overview=full&geometries=geojson&steps=false
```

## Como funciona

- Polling a cada 10s via TanStack Query.
- Cada polling dispara em paralelo (best-effort) a Edge Function `update-trip-live-status`,
  que recalcula o estado de cada viagem e grava em `trip_live_status` + `trip_alerts`.
- O RPC `get_active_trips_live(_tenant_id)` devolve o DTO consolidado (viagem + posição + rota + paradas + cargas).
- O botão "Recalcular rota (OSRM)" dispara `calculate-trip-route`, que monta os waypoints
  (posição atual do veículo + paradas com lat/lng) e salva em `trip_routes`.

## Estados

| Estado     | Quando                                              | Cor       |
|------------|-----------------------------------------------------|-----------|
| normal     | Em rota, sem anomalias                              | Azul      |
| arriving   | ≤ 1000m da próxima parada                           | Ciano     |
| at_stop    | ≤ 400m da parada com veículo lento, ou ≤ 900m parado (<3 km/h) | Verde |
| stopped    | < 3 km/h por mais de 10 min, fora de uma parada     | Amarelo   |
| delayed    | ETA > parada planejada + 5 min                      | Laranja   |
| off_route  | > 500m da rota e velocidade > 10 km/h               | Vermelho  |
| no_signal  | Sem posição há ≥ 15 min                             | Cinza     |
| critical   | Ocorrência crítica manual                           | Vermelho escuro |

## Limitações conhecidas (MVP)

- Sem histórico de posições visualizado (linha percorrida) — preparado para evolução futura.
- Tempo parado estimado pela idade do último sinal; refinaremos com janela de posições.
- Sem reordenação automática de paradas, sem WebSocket, sem Google Routes (out of scope).