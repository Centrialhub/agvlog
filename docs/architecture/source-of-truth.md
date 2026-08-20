# AGVLog Source of Truth (SoT) Manifesto
**Versão:** 1.0.0 (2026-08-20)
**Estado:** Executável / Arquitetural

Este documento define a autoridade definitiva sobre cada entidade do sistema, classificando tabelas por papel e definindo regras de escrita.

## 1. Classificação de Papéis

| Papel | Descrição |
|---|---|
| **Canônica** | Fonte de verdade absoluta. Mutação permitida apenas via RPC ou Service Role controlado. |
| **Espelho** | Cópia sincronizada para performance/filtros. Nunca deve ser a origem de uma mutação. |
| **Projeção** | Visão agregada ou derivada de outras tabelas (ex: Dashboards). |
| **Integração** | Dados de sistemas externos (Hub Fiscal, SSX). |
| **Telemetria** | Dados de alta frequência (GPS, Sensores). |
| **Legado** | Tabelas em processo de depreciação. |

---

## 2. Entidades Principais e SoT

### 2.1 Cargas (Loads)
*   **Canônica:** `loads` (Metadados da carga: número, origem, destino).
*   **Canônica (Composição):** `load_items` (Vínculo real de itens/documentos à carga).
*   **Integração:** `load_import_batches` (Metadados de importação XML/CSV).
*   **Writer Autorizado:** RPC `create_load_with_next_number`, `assign_fiscal_documents_to_load`.
*   **Nota:** `fiscal_documents.load_id` é um **Espelho** de conveniência.

### 2.2 Documentos Fiscais e Operacionais
*   **Canônica:** `fiscal_documents` (NF-e, CT-e recebidas).
*   **Integração:** `hub_fiscal_emissions` (Status de transmissão de documentos emitidos).
*   **Canônica:** `nfse_documents` (Notas de serviço).
*   **Writer Autorizado:** `hub-fiscal-proxy` (Edge Function) e RPCs de processamento.

### 2.3 Viagens e Despacho (Dispatch)
*   **Canônica (Execução):** `dispatch_trips` (Viagem operacional ativa).
*   **Canônica (Relação):** `dispatch_trip_loads` (Vínculo imutável carga-viagem após despacho).
*   **Telemetria (GPS):** `trips` (Fragmentos de telemetria baseados em movimento — **NÃO CONFUNDIR** com `dispatch_trips`).
*   **Writer Autorizado:** RPC `dispatch_planned_route`.

### 2.4 Paradas e POD
*   **Canônica:** `dispatch_stops` (Pontos de entrega/coleta operacionais).
*   **Canônica (Documentos):** `dispatch_stop_documents` (Quais NFs devem ser entregues em cada parada).
*   **Canônica (POD):** `proof_of_delivery` (Assinaturas e fotos vinculadas a `dispatch_stop_documents`).
*   **Writer Autorizado:** `driver_finalize_delivery` (RPC).

### 2.5 Rotas e Waypoints
*   **Canônica:** `operational_routes` (Catálogo de rotas regionais).
*   **Canônica:** `route_waypoints` (POIs e pontos estratégicos).
*   **Writer Autorizado:** Backoffice / Admin.

### 2.6 Clientes e Regiões
*   **Canônica:** `clients` (Cadastro central de clientes e filiais).
*   **Espelho:** `client_regions` (Zonais de frete).
*   **Writer Autorizado:** Backoffice / Ingestão automática via XML.

### 2.7 Ocorrências e Eventos
*   **Canônica:** `operational_events` (Audit log de status e interrupções).
*   **Writer Autorizado:** RPCs `driver_create_operational_occurrence`, `record_operational_event_with_status`.

### 2.8 Financeiro
*   **Canônica (Obrigações):** `financial_obligations` (Contas a pagar/receber base).
*   **Canônica (Acerto):** `driver_settlements` (Cálculo de fechamento de motorista).
*   **Canônica (Faturamento):** `client_invoices` (Faturas emitidas contra clientes).
*   **Writer Autorizado:** RPCs de fechamento financeiro e auditoria.

### 2.9 Motoristas e Veículos
*   **Canônica:** `drivers`, `vehicles`.
*   **Relacional:** `vehicle_driver_assignments` (Vínculo 1:1 bi-direcional).
*   **Espelho de Estado:** `vehicles_state` (Última posição e status de ignição).
*   **Writer Autorizado:** Backoffice / Hook `useCurrentDriver`.

---

## 3. Matriz de Propriedade (Ownership)

| Entidade | Chave de Isolamento | RLS Base |
|---|---|---|
| Quase todas | `tenant_id` | `tenant_id = auth.jwt() -> 'tenant_id'` |
| Motorista | `driver_id` | `driver_id = current_driver_id(tenant_id)` |
| Cliente (Portal) | `client_id` / `tax_id` | `tax_id` presente na lista de acesso do usuário portal |

---

## 4. Glossário de Diferenciação
*   **`trips` vs `dispatch_trips`:** `trips` são derivadas de dados de GPS/Telemetria (fragmentos de movimento). `dispatch_trips` são ordens de serviço operacionais criadas pelo planejador.
*   **`loads` vs `load_items`:** Uma carga (`load`) é o contêiner lógico. Os itens/documentos (`load_items`) são a carga física real. Se `load_items` estiver vazio, a carga é um rascunho sem valor fiscal.
