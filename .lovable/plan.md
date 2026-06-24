# Hardening Final Pré-Beta AGVLog

Vou dividir em 4 ondas para que cada parte seja revisável. Cada onda termina compilando e funcional.

---

## Onda 1 — SQL: helpers, RLS, RPCs de motorista, status canônicos

**Migração única** com:

### 1.1 Helper de download
```sql
portal_user_can_download_fiscal_document(_tenant_id, _fiscal_document_id) returns boolean
```
- Repete a lógica de `portal_user_can_access_fiscal_document`, mas exige `can_download_documents = true` **na mesma linha** de `client_portal_access` que dá acesso (mesmo `client_id` / `tax_id`).
- Substitui o check genérico do edge function.

### 1.2 Status canônicos de parada
- `public.stop_terminal_statuses() returns text[]` = `{completed, delivered, cancelled, skipped, refused, returned, partial_delivery, failed}` (damaged fica como **informativo**, não finalizador).
- `driver_finalize_delivery`, `get_active_trips_live`, `update-trip-live-status` e summaries passam a consultar este helper para decidir se a viagem pode ser encerrada.
- Viagem com **todas** as paradas em status terminal ⇒ trip status = `completed`.

### 1.3 RPCs novas / ajustadas para motorista
- `driver_update_stop_status(_stop_id, _new_status, _notes, _payload)` — aceita: `arrived`, `departed`, `delivered`, `refused`, `returned`, `partial_delivery`, `failed`, `cancelled`, `skipped`. Cada transição grava `dispatch_events` com `event_type` correspondente. **Bloqueia transições inválidas** (não permite voltar de terminal).
- `driver_register_departure(_stop_id)` — sai do cliente (departure event + `actual_departure_at`).
- `driver_create_operational_occurrence` já existe; manter.
- Confirmar que `driver_create_event`, `driver_mark_arrival`, `driver_finalize_delivery` cobrem todo o resto.

### 1.4 Portal shipment detail isolado por cliente
Reescrever `get_client_portal_shipment_detail(_fiscal_document_id)`:
- Buscar `dispatch_stop_id` específico via `dispatch_stop_documents`.
- `events`: somente `dispatch_events` com aquele `dispatch_stop_id`.
- `occurrences`: `operational_events` filtrados por **(`fiscal_document_id` = _fd) OR (`client_id` = fd.client_id AND `dispatch_stop_id` = stop_id) OR (`load_id` = fd.load_id AND `client_id` = fd.client_id)**. Nunca expor ocorrência de outro client da mesma carga.

### 1.5 Portal RPCs usando helper unificado
- `list_client_documents`, `list_client_pods`, `get_client_pod_metadata`, `get_client_portal_summary` ⇒ filtrar via `portal_user_can_access_fiscal_document(tenant_id, fd.id)` em vez de só `client_id IN allowed`. Isso cobre remetente/destinatário/payer por CNPJ.

### 1.6 RLS e modelo de cliente externo
- **Decisão**: cliente externo **não** é `tenant_member`. Remover qualquer policy que dependa de `role = 'client'` em `tenant_memberships` para: `clients`, `orders`, `fiscal_documents`, `loads`, `load_orders`, `pickup_orders`, `dispatch_trip_loads`. Essas tabelas continuam restritas a `owner/admin/operator/driver` (driver só vê o próprio trip). Cliente acessa exclusivamente via RPCs do portal.
- `get_active_trips_live` e `get_open_trip_alerts`: exigir `is_tenant_admin(_tenant_id) OR has_tenant_role(_tenant_id,'operator')`. Driver e client são bloqueados.
- Bucket `receipts`: alterar policy `receipts_tenant_select` para `admin/operator/driver` (sem client). Cliente baixa só via Edge Function com service role.

### 1.7 Unique de driver↔user
- `CREATE UNIQUE INDEX IF NOT EXISTS uq_drivers_tenant_user ON public.drivers(tenant_id, user_id) WHERE user_id IS NOT NULL;`

---

## Onda 2 — Edge Function

`supabase/functions/get-client-pod-signed-url/index.ts`:
- Trocar import problemático `npm:@supabase/supabase-js@2/cors` por **definição local** de `corsHeaders` (mesmo padrão das demais funções do projeto).
- Trocar a checagem de `can_download_documents` por chamada RPC `portal_user_can_download_fiscal_document` (passa o `fiscal_document_id` do POD).
- Manter validação de JWT via `getClaims`.

---

## Onda 3 — Frontend: driver pages, route guards, portal

### 3.1 Route guards (`src/components/auth/`)
- `RequireInternalRole` — permite `owner/admin/operator`.
- `RequireDriverRole` — permite `driver`.
- `RequireClientPortalAccess` — permite usuários com pelo menos uma linha em `client_portal_access` para o tenant atual.
- Aplicar em `App.tsx`: rotas `/driver/*` ⇒ driver; `/portal/*` ⇒ client portal; tudo administrativo ⇒ internal.

### 3.2 DriverDeliveries
- Remover **todos** os `supabase.from('dispatch_events').insert/.update` e `supabase.from('dispatch_stops').update`.
- Mapear ações:
  - `chegada_no_cliente` → `driver_mark_arrival`
  - `devolucao_parcial` → `driver_update_stop_status('partial_delivery', …)`
  - `devolucao_total` → `driver_update_stop_status('returned', …)`
  - `cliente_recusou` → `driver_update_stop_status('refused', …)`
  - `cliente_estava_fora` → `driver_update_stop_status('failed', …)`
  - `damaged`, demais informativos → `driver_create_event`
  - finalizar entrega com assinatura → `driver_finalize_delivery` (já está)

### 3.3 DriverStops
- Remover botão "Concluir Parada" ou renomear para "Registrar saída" e usar `driver_register_departure`. Conclusão real fica em DriverDeliveries.

### 3.4 Portal
- `PortalPods`: usar status `uploaded` exibindo label "Recebido"; remover badge `received` se não estiver na constraint.
- `useDownloadPortalPod` já chama a edge function — confirmar.

---

## Onda 4 — Onboarding admin UI

### 4.1 `Drivers.tsx`
- Coluna "Usuário vinculado" (mostra email do user_id).
- Form: select de usuários do tenant com role `driver` (de `tenant_memberships`), respeitando `uq_drivers_tenant_user`.

### 4.2 `TeamManagement`
- Bloquear criação de membership com `role='client'` (cliente externo agora é `client_portal_access`, não membership).
- Após criar usuário com role driver, mostrar CTA "Vincular a motorista".
- Nova aba **"Acessos do Portal"**: CRUD de `client_portal_access` com user_id, client_id, access_type e os 6 flags de permissão.

---

## Detalhes técnicos relevantes

- Migrações em SQL único por onda 1; outras ondas são frontend.
- Não vou tocar em tipos `src/integrations/supabase/types.ts` (regenerado após migração).
- Lista canônica de status terminais exposta em `src/lib/status/index.ts` para o frontend espelhar a função SQL.
- Memberships virtuais para portal-only (já feito em useTenant) continuam funcionando — `RequireClientPortalAccess` valida diretamente em `client_portal_access`.

---

## Ordem de entrega
1. **Onda 1** primeiro (migração SQL grande; precisa de aprovação).
2. Após aprovada e tipos regenerados ⇒ **Ondas 2, 3 e 4** em sequência rápida, sem mais aprovações.

Posso começar pela Onda 1?
