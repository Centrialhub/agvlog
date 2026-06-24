
# Hardening Pré-Beta Final — AGVLog

Escopo grande. Vou entregar em 4 ondas, cada onda revisada antes de seguir para próxima.

---

## Onda 1 — Banco (migration única, grande)

### 1.1 Helper SQL central de acesso do portal
- `portal_user_can_access_fiscal_document(_tenant_id, _fiscal_document_id) returns boolean` (SECURITY DEFINER).
- Verifica `client_portal_access` ativo do `auth.uid()` no `_tenant_id`, comparando contra `fd.client_id`, `fd.remitter_cnpj` e `fd.recipient_cnpj` (via `clients.tax_id`) conforme `access_type`.
- Reescrever para usar esse helper:
  - `search_client_portal_shipments`
  - `get_client_portal_shipment_detail` (recriado explicitamente, sem `pg_get_functiondef`)
  - `list_client_documents`
  - `list_client_pods`
  - `get_client_pod_metadata`
  - `get_client_portal_summary` (se existir)
- `get_active_trips_live` recriado explicitamente, com `arrived` em next-stop e `ORDER BY` correto.

### 1.2 Tenants do portal
- Confirmar `get_user_portal_tenants()` retornando união de `tenant_memberships` ativas + `client_portal_access` ativos.

### 1.3 RLS — remover policies amplas
Tabelas: `dispatch_trips`, `dispatch_stops`, `dispatch_events`, `driver_expenses`, `dispatch_stop_documents`, `proof_of_delivery`.

Substituir por:
- **owner/admin/operator**: SELECT/INSERT/UPDATE/DELETE no tenant (via `is_tenant_admin` OR `has_tenant_role('operator')`).
- **driver**: apenas SELECT, restrito a registros da própria viagem (`dispatch_trips.driver_id IN (SELECT id FROM drivers WHERE user_id = auth.uid())`).
- **client**: sem acesso direto — usa RPCs do portal.
- `proof_of_delivery`: writes só por service_role / admin / operator. Driver e client não escrevem (driver passa pela RPC `driver_finalize_delivery`).

### 1.4 RPCs novas do motorista
- `driver_update_stop_status(_stop_id, _new_status text, _reason text)` — para `partial_delivery`, `refused`, `damaged`, `returned`. Valida ownership e registra `dispatch_event` correspondente.
- `driver_create_operational_occurrence(_trip_id, _stop_id, _event_type, _severity, _description, _client_id?)` — insere em `operational_events` com `visible_to_client=true` se aplicável.

### 1.5 `driver_finalize_delivery` multi-carga
- Para cada doc em `dispatch_stop_documents` da parada, usar `dsd.load_id` (não `dispatch_trips.load_id`) no `proof_of_delivery.load_id`.
- Ao concluir viagem (todas paradas done), marcar **todas** linhas de `dispatch_trip_loads` como `delivered` e atualizar `loads.status='delivered'` para cada.
- Na primeira chegada, marcar todas as cargas da viagem como `in_transit`.
- Por documento entregue, atualizar `fiscal_documents.status='delivered'`.

### 1.6 `driver_mark_arrival` ajustado
- Primeira chegada da viagem: marca todas cargas como `in_transit`.

---

## Onda 2 — Edge Function POD

- Criar `supabase/functions/get-client-pod-signed-url/index.ts` (verify_jwt = false, valida JWT manualmente).
- Recebe `{ tenant_id, pod_id }`, usa service role para validar `client_portal_access` + `can_download_documents`, retorna `{ signed_url }`.
- Atualizar `usePortalPods.useDownloadPortalPod` para chamar a edge function e não usar mais `storage.createSignedUrl` direto.

---

## Onda 3 — Frontend portal e RLS

### 3.1 Portal tenant context
- `src/hooks/portal/usePortalTenants.ts` → chama `get_user_portal_tenants`.
- `src/components/portal/PortalTenantProvider.tsx` → seleciona tenant para usuários sem `tenant_memberships`. Persiste em `localStorage` (`agvlog_portal_tenant_id`).
- `PortalLayout` envolve com `PortalTenantProvider`.
- `useClientPortalAccess` aceita tenant do contexto do portal (não `useTenant`).
- Todos os hooks `usePortal*` usam o tenant do `PortalTenantProvider`.

### 3.2 UI administrativa de `client_portal_access`
- Página/aba em `Settings` ou `TeamManagement` (a definir simples): tabela CRUD listando registros com colunas: usuário, cliente, access_type, flags.
- Dialog para criar/editar com selects de usuário + cliente + access_type + checkboxes para as 6 permissões.

### 3.3 Drivers — vincular user
- `Drivers.tsx`: coluna "Usuário vinculado" (✓/✗).
- Form do motorista: select de usuários com role `driver` no tenant que ainda não estão vinculados.
- Constraint UNIQUE parcial em `drivers (tenant_id, user_id) WHERE user_id IS NOT NULL` (já existe? senão criar).
- `TeamManagement`: ao criar membro com role driver, mostrar ação "Vincular a motorista" → abre dialog com lista de drivers sem `user_id`.

---

## Onda 4 — Driver app, demo mode, RoutePlanning

### 4.1 Demo helper
- `src/lib/driver/demoMode.ts` com `export const canUseDriverDemo = import.meta.env.DEV;`.
- Aplicar em `DriverHome`, `DriverStops`, `DriverDeliveries`, `DriverJourney`, `DriverChecklist`, `DriverExpenses`, `DriverIssues`, `DriverEvents`, `DriverEventDetail`.
- Quando `!canUseDriverDemo`: nunca renderizar `DEMO_*`. Mostrar empty states.

### 4.2 Driver via RPC
- `DriverStops` → `driver_mark_arrival` + `driver_update_stop_status`. Remover update direto.
- `DriverDeliveries` → `driver_create_event` para informativos, `driver_finalize_delivery` já em uso.
- `DriverIssues` → `driver_create_operational_occurrence`.

### 4.3 RoutePlanning ordering helper
- `src/lib/route-planning/routeStopOrder.ts`: `export const routeStopOrder = (s) => s.manual_order ?? s.optimized_order ?? s.original_order ?? 9999;`
- Aplicar em `RoutePlanning.tsx` e demais usages com `manual_order || 0`.

---

## Ordem de entrega proposta

1. **Onda 1 (migration)** — revisada e aprovada pelo usuário.
2. **Onda 2 (edge function + uso)** — entrega junto com 1 ou após.
3. **Onda 3 (frontend portal/admin)**.
4. **Onda 4 (driver app + demo + route planning)**.

Posso seguir direto para Onda 1, ou prefere ajustar escopo de alguma onda antes?
