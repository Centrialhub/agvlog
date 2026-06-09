
# Plano: Endurecimento do fluxo /route-planning

Trabalho grande e crítico. Vou dividir em fases para reduzir risco de quebra. Cada fase é entregável e testável isoladamente.

## Arquivos principais afetados

- `src/pages/RoutePlanning.tsx` (refatorar — fonte de várias inconsistências)
- `src/hooks/route-planning/usePendingLoadsForRouting.ts` + query inline em `RoutePlanning.tsx` (adicionar `client_id`)
- `src/hooks/route-planning/useDispatchRoutePlan.ts` (separar versão sem navegação)
- `src/hooks/useRoutePlanningDrafts.tsx` (estender para persistir rota completa)
- `src/hooks/useTenant.tsx` (guard localStorage)
- Novos: `src/lib/route-planning/routeConsistency.ts`, `src/lib/route-planning/routeStatus.ts`
- Novos testes: `src/test/routeConsistency.test.ts`, `src/test/routeStatus.test.ts`
- Migration SQL: endurecer `dispatch_planned_route` + nova coluna `route_planning_drafts.plan_snapshot jsonb`

## Fase 1 — Fundação (validação + status + queries)

1. Adicionar `client_id` em ambas as queries de `fiscal_documents` (RoutePlanning inline + `usePendingLoadsForRouting`). Propagar pelo tipo `LoadItem`.
2. Criar `routeStatus.ts` com enum `RoutePlanStatus` estendido: `ready | review | blocked | dirty | dispatching | dispatched | failed`. Função `computeRouteStatus(route, validation)` derivada.
3. Criar `routeConsistency.ts` com:
   - `validateRouteConsistency(route): { valid, blockingErrors[], warnings[] }`
   - checks: stops cobrem todas loads; load_ids em stops ⊂ route.loads; FDs ⊂ loads; sem FD duplicado entre stops; cidade/destino presentes; capacidade vs veículo; janela violada → warning.
4. Tests unitários para ambos.

## Fase 2 — Consistência cargas/stops + ordenação

1. Quando `loads` muda (add/remove/move) em uma rota com stops existentes:
   - Se mudança trivial (apenas remoção): filtrar stops e marcar `dirty` se sobrar FD/load órfão; tentar auto-regenerar paradas.
   - Caso contrário: limpar `stops` e marcar `dirty`. Bloquear despacho enquanto `dirty`.
2. Remover `sortLoadsByRecipient` da renderização interna de uma rota (Opção A do brief) — preservar ordem manual. Manter sort só na lista de cargas disponíveis.
3. Reaplicar sort manual quando `moveLoad` for chamado (já é o caso, mas removendo o re-sort no render).

## Fase 3 — Despacho seguro (individual + lote)

1. Refatorar `useDispatchRoutePlan` para expor `dispatchRoute(payload)` puro (sem navegação/toast).
2. Em `RoutePlanning.tsx`:
   - `dispatchRouteMutation` (individual): chama base + navega no sucesso.
   - `dispatchBatchMutation`: itera apenas rotas com status `ready`, marca cada uma `dispatching → dispatched|failed`, acumula resultado, mostra resumo (`toast` + dialog) sem navegar.
   - Botão "Despachar em lote" desabilitado se nenhuma `ready`. Botão secundário "Despachar mesmo com alertas" requer digitação de confirmação e lista alertas.
3. Pré-validação obrigatória chamando `validateRouteConsistency` antes de cada chamada.

## Fase 4 — Persistência de drafts

1. Migration: `ALTER TABLE route_planning_drafts ADD COLUMN plan_snapshot jsonb` (rota completa serializada: loads ids, stops, vehicle/driver, planned_start_at, sortMode, status).
2. Estender `useRoutePlanningDrafts` com:
   - `useSavePlanSnapshot(routeId, snapshot)` — debounced upsert
   - `useActivePlanSnapshots()` — restaura ao montar
3. Em `RoutePlanning.tsx`:
   - useEffect debounced (1.5s) que persiste cada `route` como snapshot.
   - Ao montar: hidratar `routes` a partir dos snapshots ativos + cruzar com `pendingLoads` (descartar loads que não existem mais).
   - Banner "Existem rotas planejadas não despachadas" quando snapshots restaurados.
   - Botão "Descartar rascunho" por rota.
   - No sucesso de dispatch: marcar draft `dispatched` no servidor.

## Fase 5 — Seleção vs filtro

1. Calcular `selectedVisible` / `selectedHidden` a partir de `selectedLoads` × `filteredLoads`.
2. Mostrar chip: "Selecionadas: N (M visíveis · K fora do filtro)".
3. Em `createRouteFromSelected` / `generateAutoPlan`: se houver `selectedHidden > 0`, abrir `confirm dialog` listando-as antes de prosseguir.

## Fase 6 — Reverter XMLs

Mover botão de `/route-planning` para `/settings` (área admin) atrás de:
- `is_tenant_admin` check (já feito server-side; UI esconde se não-admin).
- Dialog com texto explicativo do impacto.
- Confirmação textual: digitar `REVERTER TODOS OS XMLS`.
- Auditoria: já registrada no RPC (não tocar SQL aqui).

## Fase 7 — SQL hardening + tenant guard

1. Migration `dispatch_planned_route` (substituir): validar array não-vazio, sem duplicatas, todos `load_ids` existem no tenant E `trip_id IS NULL` (contagem exata), todos FDs referenciados existem, toda stop tem `destination`. Erros claros em PT.
2. `useTenant.tsx`: mover `localStorage.setItem(guardKey,'true')` para dentro do `then` de sucesso da criação do tenant; mostrar toast de erro no catch.

## Fase 8 — Estados visuais

Atualizar header de cada rota com badge colorida por status + ações desabilitadas/escondidas conforme status (`dirty` → "Recalcular paradas"; `dispatching` → spinner + lock; `blocked` → tooltip com motivo).

## Testes a entregar

- `routeConsistency.test.ts` — 6+ cenários
- `routeStatus.test.ts` — transições
- `dispatchBatch.test.ts` — separa ready/review/blocked
- `routeDraftHydration.test.ts` — descarta loads inexistentes

## Pontos para decisão de produto (vou assumir defaults, mas sinalizar)

1. **Auto-regenerar stops vs apenas marcar dirty**: vou implementar híbrido — só auto-regenera se nenhuma stop tinha edição manual; caso contrário marca `dirty`.
2. **Janela violada**: gravidade = `review` (não `blocked`).
3. **Ordenação manual de cargas**: Opção A (preservar ordem manual, remover re-sort).
4. **Local do "Reverter XMLs"**: `/settings` aba "Manutenção" (criar se não houver).
5. **Persistência de draft**: por rota individual (1 draft = 1 rota planejada), não 1 draft = sessão inteira.

## Escopo / esforço

Grande. ~12-15 arquivos editados, ~5 novos, 2 migrations, 4 suites de teste. Vou executar **todas as fases na ordem** numa única rodada, mas mantendo cada commit lógico autocontido para o caso de você querer parar antes.

Posso seguir?
