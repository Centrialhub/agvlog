# Teste end-to-end do portal do cliente

Rodada de verificação funcional do `/portal/*` via Playwright headless no sandbox, cobrindo todos os fluxos que um cliente real executa. Sem alterações de código — o entregável é um relatório do estado observado + evidências (screenshots + logs de console/network) + lista de defeitos encontrados por severidade.

## Escopo do teste

Autenticação: usar a sessão Supabase gerenciada (`LOVABLE_BROWSER_AUTH_STATUS=injected`). Se o status vier `signed_out`, parar e pedir login no preview. Se `external_unmanaged`, executar apenas as rotas públicas alcançáveis e reportar.

Fluxos cobertos (um script Playwright por área, com screenshot em cada passo-chave):

1. **Bootstrap / seletor de cliente** (`PortalLayout`, `PortalClientSelector`)
   - Login → `/portal` carrega sem tela branca.
   - Se o usuário tem >1 cliente, alternar no seletor e confirmar que KPIs/listas re-fetcham escopo.
   - Confere `useTenant` fallback via `get_user_portal_tenants` para usuários portal-only.

2. **Dashboard** (`PortalDashboard`)
   - 11 KPIs renderizam (não `NaN`/`undefined`).
   - Próximas entregas: card clicável → detalhe.
   - Alertas: lista carrega, estados vazio/erro corretos.

3. **Shipments / Detail** (`PortalShipments`, `PortalShipmentDetail`)
   - Lista carrega, filtros de status funcionam, click abre detalhe.
   - Detalhe: timeline, ocorrências, provas, mapa (se `can_view_vehicle_live`).
   - Gate `can_view_financial`: valor visível/oculto conforme permissão.
   - Aba Documentos: empty state coerente (sem stub antigo).

4. **Documents** (`PortalDocuments`)
   - Coluna "Valor" só aparece com `can_view_financial`.
   - Download só habilitado com `can_download_documents`.

5. **PODs** (`PortalPods`)
   - Lista canhotos; URL assinada abre (chamar edge `get-client-pod-signed-url` e conferir 200).

6. **Occurrences + chat realtime** (`PortalOccurrences`, `OccurrenceThreadDialog`)
   - "Nova ocorrência": seletor mostra nome do cliente (não slice do UUID).
   - Criar ocorrência com `can_open_occurrences=true` → aparece na lista.
   - Abrir chat, enviar mensagem, confirmar persistência.
   - Realtime: inserir mensagem via `supabase.rpc('reply_client_occurrence', …)` em outra sessão do script e verificar que o diálogo atualiza sem refetch manual (canal `client_occurrence_messages`).
   - Botão "Conversar" oculto/desabilitado quando `can_open_occurrences=false`.

7. **Pickups** (`PortalPickups`)
   - Fluxo `request_client_pickup` end-to-end; validação de campos.
   - Cancelamento (finding conhecido: sem permissão dedicada — apenas registrar comportamento).

8. **Tracking** (`PortalTracking`)
   - Mapa carrega, marcadores por `dispatch_stops`, sem vazamento cross-client.

9. **Reports / Settings** (`PortalReports`, `PortalSettings`)
   - Relatórios renderizam sem erro; settings salva alterações permitidas.

10. **Segurança / escopo**
    - Chamar diretamente `get_client_portal_*_v2` com `_client_id` de outro cliente do mesmo tenant → deve negar.
    - Testar `portal_user_can_access_fiscal_document` com doc de cliente não-vinculado.
    - Confirmar que RPCs legadas removidas (ex.: overload antigo de `get_client_portal_tracking`) não são chamadas.

## Como o teste roda

- Um script Python por área sob `/tmp/browser/portal-e2e/<area>.py`, cada um sobe browser novo, injeta sessão via `LOVABLE_BROWSER_SUPABASE_*`, navega a partir de `http://localhost:8080/portal`.
- Viewport fixo `1280x1800`, `headless=True`, screenshots em `/tmp/browser/portal-e2e/screenshots/<area>_NN.png`.
- Cada script imprime: URL final, título, contagem de linhas nos data grids, primeiros erros de console, requisições que retornaram ≥400.
- Ao final, agrega um relatório único (`/tmp/browser/portal-e2e/report.md`) com:
  - Status por área (pass / warn / fail).
  - Screenshots referenciados.
  - Lista de defeitos com severidade (crítico = quebra funcional ou vazamento cross-client; alto = permissão errada visível; médio = UX/estado de erro; baixo = cosmético).

## Entregável

Um resumo curto no chat com:
- Total de áreas testadas e resultado.
- Defeitos críticos/altos com caminho de arquivo sugerido para correção (sem aplicar correção nesta rodada).
- Path do relatório completo + screenshots.

## Fora de escopo

- Corrigir defeitos encontrados (rodada separada, após triagem).
- Anexo em ocorrências, `can_cancel_pickup` dedicado, remoção do fallback legacy — já registrados como fora de escopo no `.lovable/plan.md`.
- Testes de carga/performance.

## Detalhes técnicos

- Pré-requisito: `LOVABLE_BROWSER_AUTH_STATUS=injected` com um usuário que tenha acesso a ≥1 cliente via `client_portal_access`. Se não houver, pausar e pedir para o usuário logar no preview como cliente antes de rodar.
- Multi-cliente: se o usuário atual só tem 1 cliente, testes de seletor viram smoke (registrar como "não coberto" no relatório).
- Realtime: valida via `supabase.channel('client_occurrence_messages').on('postgres_changes', …)` que o publication está ativo; se não, marca como defeito.
- Cross-tenant/cross-client: usar `supabase.rpc` direto no browser context (com o token do usuário atual) para tentar acesso indevido — a expectativa é receber erro ou zero linhas.
