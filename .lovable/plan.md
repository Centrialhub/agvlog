
# Rodada de auditoria funcional e consistência de dados

Escopo grande e crítico — sem features novas. Foco: fonte de verdade única, RPCs transacionais, status canônicos, auditoria.

## Fase 1 — Documento de contrato
- `docs/data-contract.md` documentando fontes de verdade: `load_items` (composição), `dispatch_trip_loads` (vínculo viagem-carga), `dispatch_stop_documents` (parada-documento), `dispatch_stops.status` (status operacional), função central de status público, e campos esperados em `operational_events`.

## Fase 2 — Migration única consolidada
Uma única migration cobrindo:

### 2.1 Evolução de `operational_events`
- Adicionar `dispatch_trip_id`, `dispatch_stop_id`, `fiscal_document_id` (nullable, FK).

### 2.2 Audit log
- Criar `entity_audit_log` (tenant_id, entity_type, entity_id, action, old_data, new_data, actor_user_id, actor_role, source, request_id, created_at).
- GRANTs + RLS (somente owner/admin lê do tenant; service_role escreve).
- Helper `_log_entity_audit(...)`.

### 2.3 RPCs de composição de carga (transacionais + auditoria)
- `assign_fiscal_documents_to_load(_tenant_id, _load_id, _document_ids)` — bloqueia se carga em viagem ativa/entregue.
- `remove_fiscal_documents_from_load(_tenant_id, _load_id, _document_ids)` — limpa `fiscal_documents.load_id` + `load_items` correspondentes.
- `move_load_items_between_loads(_tenant_id, _source_load_id, _target_load_id, _item_ids)` — bloqueia se em viagem ativa, atualiza ambas as tabelas, recalcula totais.
- `delete_load_safely(_tenant_id, _load_id)` — só se sem viagem ativa e sem POD.

### 2.4 Correção `driver_update_stop_status`
- Buscar docs via `dispatch_stop_documents`; mapear status parada → status fiscal_documents.
- Quando todas paradas do trip terminais, atualizar `dispatch_trip_loads`→loads + trip status.
- Inserir registro em `entity_audit_log`.
- Retornar jsonb com `updated_stop_id`, `updated_document_ids`, `updated_load_ids`, `trip_completed`.

### 2.5 Correção `request_client_pickup`
- Trocar `c.name`/`c.cnpj_cpf` por `COALESCE(c.trade_name, c.company_name, c.legal_name)` e `c.tax_id`.

### 2.6 Correção `create_client_occurrence`
- Validar `_load_id` via `fiscal_documents.client_id` (em vez de `load_items.client_id`).

### 2.7 Função central de status público
- `get_public_shipment_status(_fiscal_document_id)` retornando status canônico considerando: ocorrência crítica → exceções terminais → delivered+POD → delivered s/ POD → arrived/in_progress → in_transit/loading → planned.
- Atualizar `search_client_portal_shipments` e `get_client_portal_summary` para usar essa função.

### 2.8 RPC `record_operational_event_with_status`
- Insere evento, atualiza status da entidade (load|fiscal_document|dispatch_stop) com validação de transição, registra audit, retorna entidade.

### 2.9 RPC `audit_data_consistency(_tenant_id)`
- Retorna `{severity, category, entity_type, entity_id, message}[]` para todas as inconsistências listadas (load_items≠fiscal_documents.load_id, trips sem trip_loads, stops sem stop_documents, POD órfão, carga delivered c/ doc não terminal, ocorrências visíveis sem client_id, etc.).

### 2.10 Atualizar `driver_create_operational_occurrence`
- Já existe; garantir que preenche `dispatch_trip_id`, `dispatch_stop_id`, `fiscal_document_id` automaticamente.

## Fase 3 — Frontend status canônico
- Estender `src/lib/status/loadStatus.ts` (já existe parcial).
- Criar `src/lib/status/stopStatus.ts` (terminal + active + labels + tone).
- Criar `src/lib/status/documentStatus.ts` (labels + tone).
- Atualizar `src/lib/status/index.ts` exportando tudo.
- Atualizar `src/lib/portal/portalStatus.ts` para mapear via helpers se necessário.

## Fase 4 — Telas
### LoadDetail
- Remover/desabilitar fluxo legado que cria `dispatch_trips`/`dispatch_stops` diretos. Substituir por chamada a `dispatch_planned_route` (ou desabilitar botão com aviso).

### LoadReallocation
- Substituir update direto em `load_items` por `move_load_items_between_loads`.

### LoadItemsPanel / NewLoadDialog / PendingDocsGrouping / useLoads / useLoadItems
- Trocar updates diretos de composição por novas RPCs.

### DriverDeliveries / DriverStops
- Contagem de concluídas usando `TERMINAL_STOP_STATUSES`.
- Bloquear ações em status terminal.
- Aba "em rota" considera `pending/arriving/arrived/in_progress/servicing/departed`.
- Labels via helpers.

### Traceability
- Substituir update direto de status por `record_operational_event_with_status`. Corrigir fallback `confirmed`.

### Portal
- `PortalShipments`/`PortalDashboard`/`PortalDocuments`/`PortalPods` lendo status público da RPC central.
- `PortalDashboard`: esconder seções vazias ("Próximas entregas" placeholder) ou preencher com query real.

## Fase 5 — Edge functions
- `update-trip-live-status`: já considera terminais (verificado). Adicionar guard `is_tenant_operator_or_admin` no header e log estruturado de falhas.

## Fase 6 — Tela admin de auditoria
- `/data-audit` (rota apenas para owner/admin) chamando `audit_data_consistency`. Card simples: total crítico, total alerta, lista, botão re-rodar.

## Fase 7 — Verificação
- `bun run lint` + build automáticos.
- Documentar matriz de testes manuais em `.lovable/plan.md` (fluxos normal, recusa, parcial, movimentação, portal, auditoria).

## Detalhes técnicos importantes
- Todas as novas RPCs: `SECURITY DEFINER`, `SET search_path = public`, validação de papel via `is_tenant_operator_or_admin`, bloqueio quando carga em viagem ativa (`status IN ('in_transit','loading','dispatched')` ou trip ativa).
- Triggers existentes (`trg_recalc_load_totals`) continuam responsáveis por totais.
- Sentinels Radix mantidos.
- Sem aesthetic refactor.

## Considerações
- O contrato é AMPLO. Vou consolidar tudo em **uma** migration SQL grande para minimizar idas e voltas de aprovação.
- Frontend será editado em paralelo, em hunks pequenos e focados, sem reescrever componentes inteiros.
- A tela `/data-audit` será mínima (tabela + botão).
