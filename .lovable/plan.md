## Rodada final pré-beta — hardening de RLS, motorista, portal e status

Objetivo: fechar a superfície de segurança e consistência operacional antes do beta externo. Sem features novas.

---

### Fase 1 — Migration única de RLS (parte 1: helpers + telemetria/torre/frota)

Helpers SQL novos:
- `public.is_tenant_operator_or_admin(_tenant_id uuid)` — owner/admin/operator.
- `public.current_driver_id(_tenant_id uuid)` — `drivers.id` para `auth.uid()`.
- `public.driver_owns_trip(_trip_id uuid)` — trip pertence ao motorista logado.
- `public.driver_can_access_vehicle(_vehicle_id uuid)` — veículo ligado a uma trip atual/histórica do motorista.

Tabelas reescritas (drop all old policies, recriar):

| Tabela | SELECT | INSERT/UPDATE/DELETE |
|---|---|---|
| trip_live_status | op/admin tenant; driver: própria trip | só op/admin (service_role bypass) |
| trip_alerts | op/admin; driver: própria trip | só op/admin |
| trip_routes | op/admin; driver: própria trip | só op/admin |
| positions_last | op/admin; driver: veículo da trip ativa | bloqueado (só service_role) |
| vehicles | op/admin; driver: veículo da própria trip | só op/admin |
| drivers | op/admin; driver: próprio registro | só op/admin |

Remove especificamente: `trip_live_status_write_member`, `trip_alerts_write_member`, `trip_routes_write_member`, "Members can…", "Tenant members can…", `*_write_member` em todas as 6 tabelas.

### Fase 2 — Migration parte 2: operational_events + RPC motorista + portal

1. Adicionar (se faltar) colunas em `operational_events`: `dispatch_stop_id uuid`, `fiscal_document_id uuid` (nullable, FKs com ON DELETE SET NULL).
2. Reescrever policies de `operational_events`:
   - op/admin: tudo do tenant.
   - driver: apenas eventos onde `driver_id = current_driver_id` OU `dispatch_trip_id` pertence ao driver OU `dispatch_stop_id` em stop de trip do driver.
   - cliente externo: sem acesso direto.
3. Reescrever `driver_create_operational_occurrence` para:
   - Validar `drivers.user_id = auth.uid()`.
   - Derivar trip ativa, stop atual (status arrived/servicing/in_progress, senão próxima pendente), load, client, vehicle, driver, fiscal_document via `dispatch_stop_documents`.
   - `visible_to_client = true` apenas quando vinculado a `client_id`/`fiscal_document_id` E tipo não-interno.
4. Atualizar `get_client_portal_shipment_detail` para filtro tri-fold (NF id, stop-document, ou client+visible_to_client).

### Fase 3 — Frontend: helper de status + dashboards

Novo: `src/lib/status/loadStatus.ts` com `TERMINAL_STOP_STATUSES` e `LOAD_STATUS_LABELS` (10 status). Cores via tokens semânticos.

Substituir literais de status em:
- `src/pages/Dashboard.tsx`, `src/pages/Loads.tsx`, `src/pages/OperationsCenter.tsx`, `src/pages/Traceability.tsx`
- `src/pages/portal/PortalDashboard.tsx`, `src/pages/portal/PortalShipments.tsx`
- Badges/filtros de carga que hoje só listam pending/loading/in_transit/delivered/cancelled.

Adicionar `partial_delivery`, `returned`, `refused`, `failed` em todos filtros e KPIs.

### Fase 4 — Guard de portal + tenant provider

- Novo componente `RequireClientPortalAccess` em `App.tsx`:
  - Carrega `client_portal_access` ativo OU `currentRole` interno.
  - Se nada, renderiza tela "Sem acesso ao portal" (não o layout parcial).
- `useTenant`: garantir que o fallback para `get_user_portal_tenants()` já implementado seja efetivamente usado quando rota começa com `/portal`.
- Aplicar `RequireClientPortalAccess` em `<Route path="/portal" …>`.

### Fase 5 — Lockfile

- Remover `bun.lock` se existir junto de `bun.lockb`. Manter `bun.lockb`.
- `docs/ci.md` já lista `bun.lockb` — sem alterações.

### Fase 6 — Verificação

- `bun run lint`, `bun run build` (automáticos via harness).
- Documentar matriz de testes manuais em `.lovable/plan.md` (RLS por papel, motorista, status, portal) — não implementar testes automatizados nesta rodada (escopo).

---

### Ordem de execução

1. Migration 1 (helpers + telemetria/torre/frota) — aguardar approval e regeneração de types.
2. Migration 2 (operational_events + RPC + portal RPC).
3. Frontend: helper de status, dashboards, guard `RequireClientPortalAccess`, ajustes de `useTenant`.
4. Lockfile cleanup.
5. Documentar matriz de testes.

Sem novas features. Sem alterações estéticas além de tokens/labels de status.