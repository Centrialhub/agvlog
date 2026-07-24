# Vistoria do app motorista — rodada de correção

Auditoria confirmou que as bases de segurança (RLS de `fiscal_documents` por motorista, policies do bucket `receipts` por tenant, RPCs SECURITY DEFINER) já estão em ordem. O que sobrou são inconsistências funcionais e pequenos bugs. Correções conservadoras, sem novos módulos.

## 1. `DriverDeliveries.tsx` — produtos reais nas paradas
Hoje `stopProducts` sempre vem do `DEMO_PRODUCTS_BY_STOP` (IDs `demo-1..5`), então **paradas reais nunca listam itens** para devolução parcial/avaria.
- Buscar itens reais via `load_items` (ou `order_items`) associados ao `stop.load_id` numa nova query dependente de `eventForm.stop`.
- Fallback para `DEMO_PRODUCTS_BY_STOP` só quando `isDemo === true`.
- Manter shape (`{ id, name, qty }`) para não mexer no restante do form.

## 2. `DriverDeliveries.tsx` — chat de evento em produção
O state `threads` e a resposta simulada do operador estão dentro do branch `if (isDemo)`. Em eventos reais (`driver_create_event` RPC) a UI de chat fica vazia mesmo com o evento persistido.
- Para eventos reais, após sucesso do RPC, criar entrada em `threads` com o `event_id` retornado e reidratar mensagens via `operational_event_messages` (mesmo padrão já usado por `useEventMessages`).
- Limpar `threads` no `resetForm` para não crescer indefinidamente na sessão.

## 3. `DriverDeliveries.tsx` — upload de POD resiliente
Loop de upload de fotos (linhas ~347-353) não faz rollback: se a 3ª foto falhar, as 2 primeiras ficam órfãs no bucket sem link com o evento.
- Uploads em `Promise.allSettled`; se algum falhar, remover os `path` já enviados via `storage.remove()` antes de lançar o toast de erro.

## 4. `DriverHome.tsx` — mapa com dados reais (mínimo)
`DriverDeliveryMap` só é montado com `DEMO_MAP_STOPS`/`DEMO_VEHICLE_POS`. Em viagem real fica invisível.
- Quando houver `trip` real, montar `stops` a partir de `dispatch_stops` já carregado (lat/lng quando presentes) e passar `vehicle` a partir do último ponto conhecido via `positions_last` do veículo da trip. Se lat/lng ausentes, ocultar o card silenciosamente (comportamento adaptativo já usado no resto do sistema).
- Sem introduzir nova subscrição de posições — leitura simples a cada refetch da home já é suficiente nesta rodada.

## 5. `DriverChecklist.tsx` — guard de produção e Realtime
- Aplicar mesmo guard `IS_PROD` do `DriverHome` no cálculo de `isDemo` (evita checklist fictício em produção caso a flag `canUseDriverDemo` esteja mal configurada).
- Assinar `postgres_changes` em `dispatch_events` filtrado por `trip_id` para atualizar status quando outro dispositivo salvar.
- Permitir salvar com `checked.size === 0` (habilita reversão de checklist marcado por engano).

## 6. `DriverIssues.tsx` — Realtime e critério de demo
- Padronizar `isDemo` para `!trip && canUseDriverDemo && !IS_PROD` (mesmo critério de `DriverHome`/`DriverDeliveries`).
- Assinar `postgres_changes` em `operational_events` filtrado por `driver_id` para refletir mudanças (severidade, status) sem reabrir a tela.

## 7. Componentes pequenos
- **`SignaturePad.tsx`**: redimensionar o canvas em `resize`/`orientationchange` (recomputar `width/height` e reaplicar `getContext`), e emitir `onChange` também em `pointerleave`/`pointercancel` para não perder assinatura em desmount inesperado.
- **`DriverLoadNotes.tsx`**: expor `error` da query e mostrar mensagem de erro específica em vez de mascarar como "Nenhuma nota fiscal vinculada".
- **`DriverHome.tsx`**: `DemoBanner onReset` hoje desliga o demo permanentemente. Renomear ação para deixar claro ("Sair do modo demo") ou alinhar com padrão de reset já aplicado em `DriverEvents`/`DriverEventDetail` (versão que reidrata os dados fake).

## Fora de escopo (só registrado)
- Unificar checklist do motorista (`dispatch_events`) com `operational_checklists`/`checklist_executions` — mudança de modelo, exige rodada dedicada.
- Ligar `operational_events` do motorista a `incidents` formais para SLA/qualidade.

## Verificação
- `bun run build`
- `bunx vitest run` (esperado: 250 passando, sem novas quebras)
- Smoke visual no `/driver` (Home, Deliveries com trip real, Checklist, Issues) via preview.

## Detalhes técnicos
- Reaproveitar `useCurrentDriver` e padrão `useEffect` + `supabase.removeChannel` já em uso em `DriverStops`/`DriverJourney`/`DriverExpenses`.
- Nenhuma migration necessária — todas as tabelas envolvidas já têm RLS e Realtime habilitados (`loads`, `dispatch_trips`, `dispatch_stops`, `dispatch_events`, `driver_expenses`, `operational_events`).
- Sem alterações em edge functions, storage ou schema.