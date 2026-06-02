# Evolução /route-planning → Despacho Operacional Real

## Objetivo
Transformar `/route-planning` em origem operacional de execução: gerar `dispatch_trips` + `dispatch_trip_loads` + `dispatch_stops` + `dispatch_stop_documents`, com paradas consolidadas e ordenáveis, sem quebrar telas atuais do motorista.

## 1. Migração de banco (single migration)

### Novas tabelas

**`dispatch_trip_loads`** — vínculo N:N viagem ↔ cargas (hoje só existe `dispatch_trips.load_id` 1:1).
Campos: `id`, `tenant_id`, `dispatch_trip_id` (cascade), `load_id` (cascade), `created_at`, `unique(dispatch_trip_id, load_id)`.

**`dispatch_stop_documents`** — vínculo parada ↔ NF-es.
Campos: `id`, `tenant_id`, `dispatch_stop_id` (cascade), `fiscal_document_id` (cascade), `load_id` (set null), `created_at`, `unique(dispatch_stop_id, fiscal_document_id)`.

**`route_planning_stop_drafts`** — rascunho de paradas antes do despacho.
Conforme schema do brief (load_ids/fiscal_document_ids arrays, totais, janelas, risk).

**`customer_delivery_windows`** — janelas por cliente (preparação futura).
Campos do brief.

Todas com GRANT (authenticated CRUD, service_role ALL), RLS via `is_tenant_member(tenant_id)`.

### Colunas adicionadas (sem renomear/remover)

`dispatch_stops`: `estimated_departure_at`, `service_time_minutes default 20`, `delivery_window_start`, `delivery_window_end`, `latitude`, `longitude`, `risk_level default 'normal'`, `risk_reason`.

`route_planning_drafts`: `load_ids uuid[]`, `planned_date date`, `driver_id uuid`, `planned_start_at timestamptz`, `route_config jsonb`, `optimization_summary jsonb`, `validation_summary jsonb`.

### RPC atômica `dispatch_planned_route`

`SECURITY DEFINER`, valida `is_tenant_member`, recebe JSON com `vehicle_id, driver_id, planned_start_at, route_name, load_ids[], stops[]`. Faz tudo em uma transação:
1. valida posse das cargas pelo tenant e ausência de `trip_id`
2. cria `dispatch_trips` (load_id = primeira carga)
3. insert em `dispatch_trip_loads`
4. update `loads`: `trip_id`, `vehicle_id`, `driver_id`, `status='loading'`
5. cria `dispatch_stops` em ordem
6. cria `dispatch_stop_documents`
7. marca draft como dispatched se houver
8. retorna `dispatch_trip_id`

Erro em qualquer passo = rollback total.

## 2. Lib / tipos

- `src/lib/route-planning/routePlanningTypes.ts` — `RouteStopDraft`, `RoutePlanState`, `ValidationIssue`.
- `src/lib/route-planning/stopConsolidation.ts` — consolida cargas+NFes em paradas via chave `client_id|recipient|city|neighborhood`, soma totais, preserva listas.
- `src/lib/route-planning/simpleStopSequencing.ts` — ordem inteligente simples: janela mais cedo → priority desc → city → neighborhood → recipient; sem janela depois de quem tem janela exceto priority alta.

## 3. Hooks

- `src/hooks/route-planning/usePendingLoadsForRouting.ts` — cargas sem `trip_id`, com items+fiscal_documents.
- `src/hooks/route-planning/useStopConsolidation.ts` — memoiza consolidação.
- `src/hooks/route-planning/useRoutePlanBuilder.ts` — estado da rota em montagem (selectedLoadIds, vehicle, driver, plannedStartAt, stops, reorder/move up-down, modo de ordenação).
- `src/hooks/route-planning/useDispatchRoutePlan.ts` — mutation chamando RPC `dispatch_planned_route`, invalidando: `pending_loads`, `dispatch_trips`, `route_planning_drafts`, `driver_trip`, `loads`.

## 4. Componentes

- `src/components/route-planning/StopDraftTable.tsx` — tabela de paradas com ordem, destinatário/cidade/bairro, docs, totais, janela, risk, botões ↑↓.
- `src/components/route-planning/RouteValidationPanel.tsx` — lista issues (sem motorista/veículo/parada/destino/docs, possível duplicidade, capacidade).
- `src/components/route-planning/RouteDispatchDialog.tsx` — confirmação final + dispatch.

## 5. Refatoração `RoutePlanning.tsx`

Mantém:
- agrupamento por destino atual (não remover)
- geração de PDF / romaneio (se existir)
- drafts existentes

Adiciona seções:
- **Cargas disponíveis** (já existe — adapta para selecionar múltiplas)
- **Rota em montagem** (nome, veículo, motorista, planned_start_at)
- **Paradas consolidadas** (StopDraftTable, modo manual/original/inteligente)
- **Validações** (RouteValidationPanel)
- **Ações**: gerar paradas, aplicar ordem inteligente, voltar ao original, despachar (RouteDispatchDialog)

Texto: "Monte viagens, consolide paradas, defina a ordem de atendimento e envie a sequência para o motorista." Evitar "menor distância/melhor rota geográfica".

## 6. Compatibilidade

Não altera leitura de `dispatch_stops.stop_order/destination/status/planned_arrival_at/actual_*` usados em `DriverStops`, `DriverDeliveries`, `LoadDetail`, `PodHistory`, `OperationsCenter`. Apenas adiciona colunas nullable.

`dispatch_trips.load_id` continua preenchido com primeira carga = legado intacto. Novos consumidores podem ler `dispatch_trip_loads`.

## 7. Validações pré-despacho (frontend + RPC)

Frontend bloqueia botão se falta: vehicle, driver, planned_start_at, ≥1 carga, ≥1 parada, toda parada com destination/recipient.

RPC revalida tenant, posse de cargas, ausência de trip_id, posse de docs → rollback se inconsistente.

## Critérios de aceite
Conforme brief: cargas selecionáveis → paradas geradas → reordenação → dispatch cria trip+loads+stops+documents → motorista vê na ordem → telas existentes não quebram → sem promessa de otimização geográfica.

## Fora de escopo (preparado, não implementado)
OR-Tools, OSRM/Google Routes, matriz real, geocoding, mapa avançado, reotimização tempo real, multi-veículo.
