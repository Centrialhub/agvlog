## Painel de Controle Operacional (Torre de Controle) — OSRM Self-hosted

Nova tela `/operations-control` para monitorar todas as viagens ativas em tempo real, com mapa, KPIs, alertas e drawer de detalhes. Roteamento via OSRM self-hosted.

---

### 1. Pré-requisitos do usuário (antes de implementar)

Preciso confirmar com você:

1. **URL do OSRM**: você já tem um OSRM self-hosted rodando? Se sim, qual é a URL pública? (ex.: `https://osrm.seudominio.com`). Se ainda não tem, posso deixar a integração pronta e você adiciona a variável depois — mas a tela só renderiza rotas quando o OSRM estiver acessível.
2. **Secret backend**: vou adicionar `OSRM_BASE_URL` como secret do Supabase (para Edge Functions) e `VITE_OSRM_BASE_URL` no `.env` (para fallback frontend, se necessário).

---

### 2. Migrations (banco)

Criar 4 tabelas novas, todas multi-tenant com RLS no padrão do projeto (`is_tenant_member` / `is_tenant_admin`):

- `trip_routes` — rota planejada por viagem (geometry GeoJSON, distância, duração, provider='osrm'), única por `(trip_id, provider)`.
- `trip_live_status` — status operacional calculado por viagem (state, severity, próxima parada, atraso, distância da rota, ETA, último sinal). PK `(tenant_id, trip_id)`.
- `trip_alerts` — alertas operacionais abertos/fechados (off_route, delayed, stopped, no_signal, etc.).
- **Reutilizar `positions_last`** em vez de criar `vehicle_latest_positions` (já existe e cumpre o papel).

GRANTs para `authenticated` e `service_role` em todas, RLS por `tenant_id`.

Função RPC `get_active_trips_live(_tenant_id uuid)` que devolve o DTO consolidado (viagem + veículo + última posição + rota + paradas + status + cargas) para evitar N+1 no frontend.

---

### 3. Serviços / Edge Functions

- **`supabase/functions/_shared/osrm.ts`** — `calculateOsrmRoute(coordinates)` chamando `{OSRM_BASE_URL}/route/v1/driving/...?overview=full&geometries=geojson`. Validação ≥2 pontos, conversão lng,lat, tratamento de erro.
- **`supabase/functions/calculate-trip-route`** — recebe `trip_id`, monta waypoints (origem → paradas ordenadas), chama OSRM, salva em `trip_routes`.
- **`supabase/functions/update-trip-live-status`** — varre viagens ativas do tenant, busca posição (`positions_last`), rota (`trip_routes`), paradas, calcula status com regras de prioridade (`no_signal` > `off_route` > `delayed` > `stopped` > `at_stop` > `arriving` > `normal`), upsert em `trip_live_status`, cria/fecha `trip_alerts`. Usa `@turf/turf` (via npm: para Deno) para `pointToLineDistance`.

Lógica de status: thresholds conforme especificado (sinal ≥15min, desvio >500m com v>10km/h, parado <3km/h por ≥10min, chegando ≤1000m, na parada ≤150m, atrasado vs `planned_arrival_at`).

---

### 4. Frontend

Dependência nova: `@turf/turf` (para distância ponto-linha no client se necessário; principalmente backend).

Estrutura:

```
src/pages/OperationsControl.tsx          # Tela principal
src/components/control-tower/
  ControlTowerHeader.tsx                  # Header com KPIs gerais + última atualização
  ControlTowerSidebar.tsx                 # KPIs + lista de alertas + lista de viagens
  ControlTowerMap.tsx                     # Leaflet: rotas, marcadores, paradas
  VehicleMarker.tsx                       # Ícone L.divIcon com placa + status (cores por state)
  TripDetailsDrawer.tsx                   # Drawer ao clicar no veículo
  AlertsPanel.tsx                         # Lista ordenada por severidade
  KpiCards.tsx                            # Cards: em rota, normal, atrasados, fora rota, parados, sem sinal
src/hooks/useActiveTripsLive.ts           # useQuery com refetchInterval: 10000
src/lib/controlTower/
  stateColors.ts                          # routeColorByState, severity → tokens
  stateLabels.ts                          # labels PT-BR
```

Rota em `App.tsx`: `/operations-control` dentro de `ProtectedRoute`.
Item de menu no `AppLayout` (sidebar).

Mapa em Leaflet 4.2.1 (já é o padrão do projeto, `react-leaflet@4.2.1`). Fullscreen, auto-fit bounds nas viagens ativas, polylines com cor conforme `state`, markers com `L.divIcon` HTML mostrando placa.

Drawer com: dados atuais (vel, vel média, distância da rota, atraso, ETA), próxima parada, paradas concluídas/pendentes, cargas vinculadas, ações (recalcular rota = trigger Edge Function; centralizar; abrir viagem). Ações sem lógica final ficam disabled com tooltip "em breve".

Polling 10s via TanStack Query, mantendo último estado em caso de falha, indicador "Atualizado há Xs".

---

### 5. Comportamento adaptativo

- Viagem sem rota: botão "Calcular rota" no drawer (chama `calculate-trip-route`).
- Veículo sem posição recente (>15min): renderiza no estado `no_signal` se houver última posição conhecida; oculta se nunca houve.
- OSRM offline: status engine continua funcionando (sem cálculo de distância-da-rota); UI mostra aviso discreto "Rota não disponível".
- Sem paradas geocodificadas: rota parcial com os waypoints válidos.

---

### 6. Cron (opcional, MVP)

Posso adicionar `pg_cron` chamando `update-trip-live-status` a cada 1min para manter `trip_live_status` fresco em background. Como envolve dados específicos do usuário (URL da function + anon key), faço via `supabase--insert` separado, **somente se você confirmar**. Caso prefira, o `get_active_trips_live` chama o recálculo on-demand antes de retornar (mais simples, sem cron).

---

### 7. Fora de escopo (conforme pedido)

Google Routes, OR-Tools, WebSocket, IA preditiva, WhatsApp automático, replay de viagem, app mobile, reordenação automática de paradas.

---

### Plano de execução (incremental)

1. Migration (tabelas + GRANTs + RLS + RPC).
2. Edge Functions (OSRM service, calculate-trip-route, update-trip-live-status).
3. Hook + tipos no frontend.
4. Tela + componentes (Header, Sidebar, Map, Markers, Drawer, KPIs, Alerts).
5. Rota + item de menu.
6. Documentação curta em `docs/control-tower.md` explicando configuração do OSRM.

---

### Perguntas antes de começar

1. Você já tem OSRM self-hosted rodando? Qual a URL? (ou implemento e você configura depois)
2. Quer cron automático (recalc a cada 1min) ou recálculo on-demand quando a tela carrega?
3. Confirma o caminho `/operations-control` (vs `/control-tower`)?
