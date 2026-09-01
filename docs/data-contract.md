# AGVLog — Data Contract

Fontes de verdade obrigatórias para toda mudança operacional. Telas que tocam apenas em um espelho **estão erradas** e precisam ser corrigidas via RPC.

## Composição de carga

- **Fonte de verdade:** `load_items` (totais, itens, vínculo de NF).
- **Espelho permitido:** `fiscal_documents.load_id`.
- **Toda mutação:** via RPC.
  - `assign_fiscal_documents_to_load(_tenant_id, _load_id, _document_ids)`
  - `remove_fiscal_documents_from_load(_tenant_id, _load_id, _document_ids)`
  - `move_load_items_between_loads(_tenant_id, _src, _tgt, _item_ids)`
  - `delete_load_safely(_tenant_id, _load_id)`
- Nenhuma tela pode dar `UPDATE` direto em `load_items.load_id` nem em `fiscal_documents.load_id`.

## Vínculo viagem-carga

- **Fonte de verdade:** `dispatch_trip_loads`.
- **Espelho permitido:** `loads.trip_id`.
- **Toda criação de viagem:** via `dispatch_planned_route(_payload)`. Inserir direto em `dispatch_trips` está proibido — quebra `dispatch_trip_loads` e `dispatch_stop_documents` e cria viagens que `driver_finalize_delivery` não encontra.

## Vínculo parada-documento

- **Fonte de verdade:** `dispatch_stop_documents`.
- POD (`proof_of_delivery`) deve ser criado **a partir** de `dispatch_stop_documents`. Não confie em `fiscal_document_id` enviado direto pelo frontend.

## Status de parada

- **Fonte de verdade operacional:** `dispatch_stops.status`.
- Lista canônica de status **terminais** vive em `public.stop_terminal_statuses()` e no frontend em `src/lib/status/stopStatus.ts` (`STOP_TERMINAL_STATUSES`).
- Lista canônica de status **ativos** vive em `src/lib/status/stopStatus.ts` (`STOP_ACTIVE_STATUSES`).
- Mudança de status do motorista vai por `driver_update_stop_status(_stop_id, _new_status, _reason)` — atualiza `dispatch_stops`, `fiscal_documents` vinculados e `loads` quando todas as paradas forem terminais.

## Status público da mercadoria

- Calculado por `public.get_public_shipment_status(_fiscal_document_id)`.
- Considera, em ordem: ocorrência crítica visível → exceções terminais → delivered + POD → delivered sem POD → parada arrived → load in_transit → loading/loaded → planejada.
- Telas do portal usam essa função em vez de lógica TypeScript duplicada.

## Ocorrências

- `operational_events` deve apontar, quando aplicável, para:
  `dispatch_trip_id`, `dispatch_stop_id`, `fiscal_document_id`, `load_id`, `client_id`, `driver_id`, `vehicle_id`.
- Ocorrências do motorista entram por `driver_create_operational_occurrence`: a viagem é obrigatória; parada/cliente/nota/carga só são associados quando há parada explícita. A seleção vazia permanece no escopo da viagem, interna e sem esses vínculos.
- Ocorrências do cliente entram por `create_client_occurrence` — valida acesso ao cliente.
- Ocorrências do operador, com mudança de status, entram por `record_operational_event_with_status`.

## Auditoria

- Toda RPC crítica grava em `entity_audit_log` (composição, status, exceções, downloads).
- A auditoria de consistência completa do tenant é executada via `audit_data_consistency(_tenant_id)` e exibida em `/data-audit` para owner/admin.
- Antes do beta externo a expectativa é que `audit_data_consistency` retorne **zero críticos**.

## Helpers SQL relacionados

| Helper | Para que serve |
|---|---|
| `is_tenant_operator_or_admin(_tenant_id)` | Gate em RPCs de mutação interna |
| `current_driver_id(_tenant_id)` | Mapeia `auth.uid` para `drivers.id` |
| `driver_owns_trip`, `driver_owns_stop`, `driver_can_access_vehicle` | RLS do motorista |
| `portal_user_can_access_fiscal_document`, `..._view_financial`, `..._download_documents` | Gates do portal externo |
| `stop_terminal_statuses()` | Lista canônica de status terminais de parada |
| `_load_is_locked(_load_id)` | Bloqueia mutação em carga em viagem ativa ou já entregue |

## Regras absolutas

- ❌ Nunca `UPDATE` direto em `load_items.load_id`, `fiscal_documents.load_id`, `dispatch_stops.status`, `dispatch_trips.status` ou `loads.status` a partir de tela.
- ❌ Nunca `INSERT` direto em `dispatch_trips` / `dispatch_stops` / `dispatch_stop_documents` a partir de tela.
- ❌ Nunca recalcular status público no frontend para o portal — usar `get_public_shipment_status` (RPC central) ou um campo derivado de `search_client_portal_shipments`.
