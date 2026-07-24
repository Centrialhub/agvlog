# Vistoria do portal do cliente — rodada de correção

Auditoria confirmou que o núcleo de escopo por `client_id` já é feito nas RPCs (`get_client_portal_*_v2`, `create_client_occurrence`, `request_client_pickup`, `portal_user_can_access_fiscal_document`). Restam gaps concretos de permissão na UI, estados de erro engolidos, código morto perigoso e ausência de realtime no chat de ocorrência. Sem novos módulos.

## 1. `src/pages/ClientPortal.tsx` — remover código morto
Arquivo consulta `orders`/`loads` filtrando **apenas por `tenant_id`**, sem `client_id`. Não está roteado no `App.tsx`, mas é uma landmine: qualquer rota futura para ele vaza dados entre clientes do mesmo tenant.
- Apagar `src/pages/ClientPortal.tsx`.
- Confirmar via `rg ClientPortal` que nenhum import remanescente exista.

## 2. `src/pages/portal/PortalDocuments.tsx` — gate financeiro
Coluna "Valor" (linha ~97) exibe `d.value` sem checar `can_view_financial`. `PortalShipmentDetail.tsx` já faz isso corretamente.
- Ocultar coluna e célula quando `!can('can_view_financial')` via `usePortalClientScope`.
- Mesmo tratamento para totais/summary se existirem.

## 3. `src/pages/portal/PortalOccurrences.tsx` — usabilidade e permissão do chat
- Trocar `c.client_id.slice(0, 8)` (linha ~102) por `c.client_name` no seletor do diálogo "Nova ocorrência", igualando ao padrão de `PortalPickups.tsx`.
- Envolver botão "Conversar"/`OccurrenceThreadDialog` num check de `can('can_open_occurrences')` (mesma permissão usada para abrir). Sem novo permission — apenas alinhamento client-side; server-side já valida via `_portal_user_has_perm` no `reply_client_occurrence` (confirmar no migration antes de aplicar; se não validar, adicionar um `raise exception` na RPC).

## 4. Realtime no chat de ocorrência
`OccurrenceThreadDialog` só atualiza no refetch manual — cliente não vê resposta do operador sem fechar/reabrir.
- Adicionar `useEffect` com `supabase.channel(...).on('postgres_changes', ...)` filtrado por `occurrence_id` em `client_occurrence_messages`, invalidando `usePortalOccurrenceMessages` no evento. Cleanup com `supabase.removeChannel`.
- Confirmar que a tabela `client_occurrence_messages` está no publication `supabase_realtime`; caso não, migration append-only `ALTER PUBLICATION supabase_realtime ADD TABLE public.client_occurrence_messages;`.

## 5. Estados de erro visíveis nas listas
Hooks `usePortalShipments`, `usePortalDocuments`, `usePortalPods`, `usePortalPickups`, `usePortalOccurrences`, `usePortalTracking` retornam apenas `data`/`isLoading`. Falha de RPC vira "empty state" silencioso.
- Nas páginas correspondentes, desestruturar `error` da query e, quando `error`, renderizar um bloco de erro (padrão `PortalEmptyState` com variante `variant="error"` ou um `Alert destructive` com botão "Tentar novamente" → `refetch`).
- Não trocar o shape dos hooks; só consumir `error` que o React Query já expõe.

## 6. `useClientPortalAccess.ts` — log de fallback
Fallback v2→legacy engole o erro do v2 silenciosamente.
- Manter o fallback, mas logar `console.warn('[portal] detailed access RPC failed, falling back', detailed.error)` para diagnóstico. Nada muda no comportamento do usuário.

## 7. `PortalShipmentDetail.tsx` — stub de download
Aba "Documentos" mostra "será habilitado quando os arquivos estiverem disponíveis" (linhas ~180-183). Sem escopo para implementar geração/serviço agora.
- Substituir por `PortalEmptyState` com título "Downloads indisponíveis" para não passar sensação de bug. Registrar como fora de escopo.

## Fora de escopo (só registrado)
- Anexo de arquivos em ocorrências do cliente (finding 20) — exige bucket dedicado + policy + upload flow. Rodada própria.
- Permissão separada `can_cancel_pickup` (finding 23) — mudança de modelo de permissões.
- Legacy fallback nos demais hooks v2 (finding 14) — só compensa se planejarmos remover as RPCs v2 no curto prazo.

## Verificação
- `bun run build`
- `bunx vitest run` (esperado: 250 passando, sem novas quebras)
- Smoke visual em `/portal` com um usuário multi-cliente: alternar cliente no seletor, abrir ocorrência, ver chat atualizar em tempo real, checar coluna "Valor" oculta quando `can_view_financial=false`.

## Detalhes técnicos
- Nenhuma alteração em edge functions.
- Migration apenas se `client_occurrence_messages` não estiver no publication realtime.
- Padrão de subscription já em uso em `DriverStops`/`DriverIssues` — reaproveitar.
- Sem mudanças em RLS (todas as RPCs relevantes já validam client scope server-side).
