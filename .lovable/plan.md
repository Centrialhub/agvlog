# Evolução do Portal do Cliente AGVLog

Escopo enorme (19 seções, ~15 RPCs novas, ~10 componentes, tabelas novas). Impossível entregar tudo com qualidade em uma única iteração sem risco de quebra. Proposta: **4 fases incrementais**, cada uma entregando valor utilizável, com build/lint/testes verdes ao fim de cada fase.

## Fase 1 — Navegação, escopo de cliente e Dashboard real

**Objetivo:** Cliente entra no portal e vê status real, sem placeholders.

- `PortalLayout`: menu desktop com Início, Mercadorias, Tracking, Coletas, Documentos, Canhotos, Ocorrências, Relatórios, Configurações. Bottom nav mobile com 5 itens + botão "Mais" (Sheet).
- Rotas em `App.tsx`: `/portal/tracking`, `/portal/reports`, `/portal/settings`.
- **RPC nova:** `get_user_client_access_detailed` (nome + tax_id + permissões).
- **Componente novo:** `PortalClientSelector` no header (aparece se >1 cliente). Contexto `PortalClientScopeProvider` + hook `usePortalClientScope` com `can(permission)`.
- **RPCs novas:** `get_client_portal_summary_v2`, `get_client_portal_upcoming_deliveries`, `get_client_portal_alerts` (respeitando permissões driver/vehicle).
- `PortalDashboard`: KPIs expandidos, lista real de próximas entregas, lista real de alertas com link direto.
- Componentes reutilizáveis: `PortalKpiCard`, `PortalAlertList`, `PortalPermissionGate`.

## Fase 2 — Mercadorias, Detalhe e Canhotos

- `PortalShipments`: filtros expandidos (período, cidade, UF, com/sem canhoto, com ocorrência, atrasadas, hoje/amanhã), chips rápidos, cards mobile enriquecidos, ações rápidas por permissão.
- `PUBLIC_STATUS_LABELS`: revisar labels amigáveis em `src/lib/portal/portalStatus.ts`.
- **RPC nova:** `get_client_portal_shipment_detail_v2` retornando `timeline[]` unificada.
- `PortalShipmentDetail`: cabeçalho executivo com CTAs, abas (Visão geral / Timeline / Documentos / Canhotos / Ocorrências / Tracking), timeline vertical.
- Componentes: `PortalShipmentCard`, `PortalShipmentTimeline`, `PortalFilterBar`, `PortalDownloadButton`.
- `PortalPods`: busca por NF, filtros de período/status/pendentes, cards mobile, mensagens de "arquivo pendente".
- `PortalDocuments`: paginação, filtros, link para detalhe da mercadoria. Download seguro apenas se arquivo existir (senão botão desabilitado com tooltip). Edge Function `get-client-document-signed-url` **só se** verificarmos que há coluna `storage_path` em `fiscal_documents`; caso contrário, adiar.

## Fase 3 — Tracking, Coletas, Ocorrências

- **RPC nova:** `get_client_portal_tracking` sanitizando lat/lng/plate/driver por permissão.
- `PortalTracking`: mapa Leaflet (react-leaflet 4.2.1 já no projeto) + lista lateral + filtros. Modo "sem live tracking" (timeline pública) quando permissão ausente.
- **Migration aditiva:** tabela `client_pickup_requests` + grants + RLS.
- **RPC nova:** `request_client_pickup_v2`.
- `PortalPickups`: formulário expandido, lista com status detalhado, cancelamento restrito a `requested/under_review`.
- **Migration aditiva:** tabela `client_occurrence_messages`.
- **RPCs novas:** `create_client_occurrence_v2` (com `_fiscal_document_id`, `_pickup_order_id`, `_pod_id`, `_dispatch_stop_id`), `list_client_occurrence_messages`, `reply_client_occurrence`.
- `PortalOccurrences`: abrir ocorrência a partir de NF/coleta/canhoto/carga, resposta do cliente quando `client_action_required`.

## Fase 4 — Relatórios, Configurações, TeamManagement

- **RPC nova:** `get_client_portal_reports_summary`.
- `PortalReports`: entregas por período, atrasadas, canhotos pendentes, ocorrências por tipo, coletas, ranking cidades, prazo médio. Exportação CSV client-side.
- `PortalSettings`: informativo (clientes vinculados, permissões, preferências locais em `localStorage`).
- `TeamManagement` aba portal: exibir nome/e-mail do usuário e nome do cliente, tipo em pt-BR, botão "copiar link", status ativo/inativo, renomear "Baixar canhotos" → "Baixar documentos/canhotos", texto explicativo.

## Regras transversais

- Migrations apenas aditivas, com `GRANT` para `authenticated` e `service_role`.
- RPCs `SECURITY DEFINER` reutilizando helpers existentes (`_portal_user_client_ids`, `_portal_user_has_perm`, `portal_user_can_*`).
- Nunca queries diretas a tabelas sensíveis no frontend do portal.
- Estados de loading/vazio/erro consistentes; datas pt-BR; valores BRL; debounce em buscas; paginação; "limpar filtros".
- Ao final de cada fase: `bun run test` + `bun run build` verdes.

## Confirmação

Este plano é grande mesmo dividido. Recomendo executar **fase a fase**, com sua validação entre uma e outra — a primeira fase (Navegação + Dashboard) já entrega um salto perceptível ao cliente final.

**Devo começar pela Fase 1?** Se preferir outra ordem (ex.: priorizar Tracking, ou Coletas), me avise antes que eu comece a codar.
