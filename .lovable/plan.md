
# Portal do Cliente AGVLog — Plano de Entrega

O escopo solicitado é muito grande para um único ciclo (5 migrations, 10+ RPCs, 30+ arquivos novos, mapa, exportações, área administrativa). Para manter qualidade e segurança, proponho dividir em **4 fases**. Cada fase é independente, deixa o sistema funcionando e pode ser validada antes da próxima.

## Fundação que vale para todas as fases

- Não tocar em `auth`/`storage`/`realtime`.
- Toda consulta do portal via **RPC SECURITY DEFINER** filtrando por `client_portal_access` + `auth.uid()`. Nada de query direta por `tenant_id` no frontend cliente.
- `GRANT` explícito em toda tabela nova (regra do projeto).
- Bucket `receipts` já existe e é privado → usado para POD/canhotos via signed URL.
- Status público unificado calculado em `src/lib/portal/portalStatus.ts` a partir de `dispatch_*`, `loads`, `pickup_orders`, `proof_of_delivery`, `operational_events` — uma única fonte de verdade no frontend.

---

## Fase 1 — Segurança, schema e dashboard (esta entrega)

Objetivo: travar o acesso e ter um `/portal` funcional substituindo o atual.

### Migration 1
- `client_portal_access` (com `access_type`, flags `can_*`, UNIQUE por tenant+user+client+access_type).
- `proof_of_delivery` (POD estruturado, FK para `fiscal_documents`, `loads`, `dispatch_trips`, `dispatch_stops`).
- ALTER `operational_events` adicionando `visible_to_client`, `client_action_required`, `client_opened`, `public_status`, `client_resolution_note`.
- Funções: `get_user_client_access(_tenant_id)`, `user_has_client_access(_client_id)`, `get_client_portal_summary(_tenant_id, _start, _end)`.
- GRANTs + RLS + policies em todas as tabelas novas (cliente só vê suas linhas via `user_has_client_access`).

### Frontend
- Reescrita de `src/pages/ClientPortal.tsx` → estrutura `src/pages/portal/` + `src/components/portal/` + `src/hooks/portal/` + `src/lib/portal/`.
- Rotas aninhadas em `App.tsx`:
  - `/portal` → `PortalDashboard` (KPIs + próximas entregas + alertas + busca global)
  - placeholders navegáveis para `shipments`, `pickups`, `documents`, `pods`, `occurrences`, `reports`, `tracking/:loadId`, `settings` (cada um com `PortalEmptyState` "em construção" para evitar 404).
- `PortalLayout` com sidebar desktop + bottom nav mobile, header com busca global e seletor de cliente quando o usuário tem mais de um vínculo.
- Hook `useClientPortalAccess` → bloqueia render se usuário não tem nenhum acesso.

## Fase 2 — Listagem e detalhe de mercadorias

- RPCs `search_client_portal_shipments` e `get_client_portal_shipment_detail` (joins respeitando access_type: remitter/recipient/payer/full).
- View `client_portal_shipments` (ou materializada como CTE dentro da RPC se algum campo não existir no schema atual — checar primeiro).
- `/portal/shipments` (tabela desktop + cards mobile, todos os filtros listados, exportação CSV).
- `/portal/shipments/:documentId` (timeline, dados fiscais, operacionais, documentos, ocorrências, POD).
- `get_client_document_download_url` → signed URL com validação dupla de escopo.

## Fase 3 — Coletas, documentos, POD e ocorrências

- `/portal/pickups` (+ RPC `request_client_pickup` quando `can_request_pickup`).
- `/portal/documents` (abas NF-e/CT-e/MDF-e/romaneios/canhotos/faturas).
- `/portal/pods` (filtros por status de POD, validação interna).
- `/portal/occurrences` (+ RPC `create_client_occurrence` quando `can_open_occurrences`, lista filtrada por `visible_to_client`).

## Fase 4 — Rastreamento, relatórios e administração

- `/portal/tracking/:loadId` com mapa (`react-leaflet` 4.2.1 — limitação do projeto), mascarando paradas de terceiros via RPC dedicada.
- `/portal/reports` com exportação CSV/Excel; bloco financeiro condicional a `can_view_financial`.
- Aba **Portal do Cliente** em `/clients/:id` (admin interno): convidar usuário, definir `access_type`, toggles de permissões, filiais autorizadas, histórico de acesso.

---

## Detalhes técnicos relevantes

- Campos como `remitter_cnpj`, `recipient_cnpj`, `client_load_number`, `pickup_order_id`, `delivery_meta` em `fiscal_documents` precisam ser verificados antes da view — se algum não existir no schema atual, adapto a RPC para usar apenas o que existe e marco como TODO no código (sem quebrar build).
- Status público calculado por prioridade: ocorrência crítica > entregue > POD > parada em andamento > trânsito > carregado > planejado > coleta > apenas importado.
- Frontend nunca confia em flags locais para autorização — toda escrita passa por RPC que revalida `client_portal_access`.
- Realtime opcional (Fase 4) só se necessário para tracking ao vivo.

---

## Pontos que precisam de decisão antes da Fase 2

1. **Vínculo remetente/destinatário**: confirmar se `fiscal_documents` tem `remitter_cnpj`/`recipient_cnpj` ou se o match é por `client_id` + tabela de filiais. Determina como o `access_type` filtra.
2. **CT-e / MDF-e / faturas**: existem hoje (`cte_documents`, `nfse_documents`) mas o vínculo com cliente externo pode não estar mapeado — pode exigir migration adicional.
3. **Convite de usuário cliente**: usar mesmo fluxo de `create-team-member` (Admin API) ou novo edge function dedicado a clientes externos?

---

## Confirmação necessária

Posso começar pela **Fase 1** agora (migration + dashboard + estrutura de rotas + segurança), entregar funcional, e seguir para Fase 2 na próxima rodada?

Se preferir um recorte diferente (ex.: priorizar shipments antes do dashboard, ou entregar tudo de schema de uma vez e UI depois), me avise antes de eu iniciar.
