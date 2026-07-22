## Objetivo

Smoke test read-only da roteirização de ponta a ponta: ingestão → agrupamento → rotas operacionais → planejamento (RoutePlanning) → realocação (LoadReallocation) → romaneio → despacho. Sem alterar código nem dados.

## Verificações

### 1. Banco (SQL via supabase--read_query)

- **Duplicidades de rotas operacionais** por chave normalizada (`op_route_norm(name)`), inativas incluídas.
- **Rotas cobrindo a mesma cidade**: cidades com >1 rota ativa (fonte de ambiguidade que `PendingDocsGrouping` resolve mal).
- **Waypoints/destinations** por rota: contagem, órfãos, cidades duplicadas dentro da mesma rota (com e sem acento).
- **`route_planning_drafts`**: quantidade, drafts órfãos, `updated_at` antigos, `route_config` malformado (jsonb sem `stops` ou `stops[].loadIds`).
- **`route_planning_stop_drafts`**: confirmar tabela vazia (dead schema conhecido).
- **`loads` prontas para roteirizar** (`status IN planned/ready`, `on_hold=false`) sem `destination` ou com `destination` divergente da cidade da NF.
- **Cargas com `trip_id`** cujo trip está em `planned`/`in_progress` (sanity do pipeline pós-planejamento).
- **NFs sem `recipient_city`** ou com cidade que não bate com nenhuma rota ativa.
- **Índice único e trigger de audit** de nome de rota ativos.

### 2. Código (leitura estática, sem edição)

Confirmar o estado das divergências mapeadas na auditoria anterior:
- `normalizeCityKey` importado só em `GroupingStep.tsx` ainda?
- `PendingDocsGrouping.tsx` ainda com `includes()` fuzzy sem sort/ambiguidade?
- `RoutePlanning.tsx` e `LoadReallocation.mergeDestinations` ainda com `.trim().toUpperCase()` sem NFD?
- `OperationalRoutesPage.tsx` ainda com `norm` duplicado local?

### 3. UI (Playwright headless, sem login — só o que a rota pública renderiza)

- Boot de `/route-planning`, `/reallocation`, `/loads`, `/operational-routes`, `/ingestion` — todos devem redirecionar para `/auth` sem crashar (guarda de auth).
- Coletar console errors e HTTP≥400 durante o boot dessas rotas (detecta erros de import/bundle).

### 4. Testes automatizados

- Rodar `bunx vitest run` completo (foco em `routeConsistency.test.ts`).
- Sinalizar cobertura ausente para `loadGrouping`/`stopConsolidation`/`normalizeCityKey` (já sabido).

## Entregável

Relatório único com:
- Tabela de checks SQL (OK/Alerta/Falha + contagens/IDs).
- Estado atual do código vs auditoria anterior (o que já foi corrigido, o que segue pendente).
- Boot UI: rotas que carregam limpas vs quebradas.
- Testes: passa/falha, total.
- Lista final de anomalias reais com sugestão mínima de correção — sem implementar nada.

Se aparecer bloqueador novo, abrir plano corretivo em rodada separada.
