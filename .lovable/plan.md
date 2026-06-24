# Hardening Pré-Beta AGVLog

Esse é um trabalho grande (11 frentes). Proponho dividir em **5 fases independentes**, cada uma entregue como um conjunto fechado de migração + código + verificação. Confirme se a ordem faz sentido ou se quer reordenar/cortar algo antes de eu começar.

---

## Fase 1 — Segurança de dados (CRÍTICA, primeiro)
Foco em vazamentos reais já presentes em produção.

**Backend (migration única)**
- `search_client_portal_shipments`: remover `bool_or(can_view_financial)` global. Calcular `_can_financial_clients uuid[]` (clientes com permissão) e mascarar `value`/`freight_value` por linha conforme `client_id` ∈ desse array. Fallback equivalente para acesso por `recipient_cnpj`/`remitter_cnpj`.
- `get_client_portal_shipment_detail`: mesma lógica por documento. Substituir `row_to_jsonb(l/dt/ds/e/p)` por DTOs explícitos (apenas campos públicos). Remover `storage_path`/`storage_bucket` de `proofs` — devolver `has_file`, `id`, `proof_type`, `received_at`, `receiver_name`.
- `list_client_documents`: mascarar `value` por documento conforme permissão do `client_id`.
- `list_client_pods`: remover `storage_bucket`/`storage_path`. Manter `id` e usar RPC `get_client_pod_metadata` (já existe) + signed URL para download.
- `create_client_occurrence`: validar que `_load_id` (se enviado) tem `tenant_id = _tenant_id` E (`client_id = _client_id` OU existe `fiscal_documents` da carga com esse `client_id`). Mesmo para `_order_id`. Senão `RAISE EXCEPTION 'access_denied'`.
- **Storage `receipts`**: dropar policies amplas e recriar exigindo `(storage.foldername(name))[1]::uuid IN (SELECT public.get_user_tenant_ids())` para SELECT/INSERT/UPDATE/DELETE em `authenticated`. Cliente portal NÃO acessa o bucket diretamente — somente via `get_client_pod_metadata` + signed URL server-side.

**Frontend**
- `usePortalPods` / página PODs: parar de exibir `storage_path` e usar RPC para gerar signed URL no clique de "Baixar".

---

## Fase 2 — App do motorista + finalize_driver_delivery
**Backend**
- Nova RPC `finalize_driver_delivery(_trip_id, _stop_id, _payload jsonb)` SECURITY DEFINER:
  - Valida `auth.uid()` ↔ `drivers.user_id` ↔ `dispatch_trips.driver_id`.
  - Valida `tenant_id` consistente entre trip/stop/docs.
  - Insere `dispatch_events` (`type='delivery_completed'`).
  - Atualiza `dispatch_stops` (status, `actual_arrival_at`, `actual_departure_at`).
  - Upsert `proof_of_delivery` por `fiscal_document_id` da parada (`dispatch_stop_documents`).
  - Atualiza `fiscal_documents.status='delivered'` e recalcula `loads.status` quando todas as paradas concluírem.
  - Tudo em transação; retorna jsonb resumo.

**Frontend**
- `DriverDeliveries`: substituir as múltiplas chamadas soltas por uma única `supabase.rpc('finalize_driver_delivery', …)`.
- `DriverHome`:
  - `DEMO_*` e `demoActive` só sob `import.meta.env.DEV`. Em produção: nunca exibe demo.
  - Quando houver `activeTrips.length > 0`, não renderizar `DEMO_MAP_STOPS`.
  - Query de viagens ativas com `.in('status', ['planned','loading','dispatched','in_progress'])`.

---

## Fase 3 — Unificação de status
**Frontend**
- Criar `src/lib/status/index.ts` com:
  - `TRIP_ACTIVE_STATUSES = ['planned','loading','dispatched','in_progress']`
  - `STOP_ARRIVED_STATUSES` mapeando o nome canônico (decidir entre `arrived` vs `arriving`+`in_progress`).
  - Mappers de label PT-BR.
- Substituir literais espalhados pelas páginas (`DriverHome`, `DriverStops`, `Loads`, control-tower).

**Backend (migration)**
- `get_client_portal_summary.pending_pickup`: trocar `('requested','scheduled','confirmed')` por status reais (`'pendente','agendado','confirmado'` conforme `pickup_orders`). Vou confirmar lendo a tabela antes.
- Considerar CHECK constraint leve em `pickup_orders.status` (opcional, sinalizar se for arriscado com dados existentes).

**Decisão necessária do usuário**: para `dispatch_stops`, o padrão canônico é `arrived` (um estado) ou `arriving`+`in_progress` (dois estados)? Vou assumir **`arriving`+`in_progress`** (já usado no backend de live status e em `dispatch_stops`) e alinhar o app driver, salvo orientação contrária.

---

## Fase 4 — useTenant + portal cliente UX
**Frontend**
- `useTenant`: remover auto-criação de tenant (mover para botão explícito em onboarding). Se `localStorage.agvlog_tenant_id` não bater com nenhuma membership ativa, limpar e selecionar a primeira válida. Não confundir com `client_portal_access` (portal continua usando seu próprio fluxo).
- `PortalLayout`: remover busca global se não estiver ligada a nada (mais simples para beta) — OU passar `?q=` para `PortalShipments`. Vou remover por padrão; reabilitar é trivial depois.
- Adicionar seletor de cliente quando `useClientPortalAccess().data.length > 1` (Select no header do PortalLayout, persistindo em localStorage `agvlog_portal_client_id`).
- Esconder do menu páginas em construção (`PortalReports`, `PortalSettings` se vazias) ou marcar com badge "Em breve".

---

## Fase 5 — package-lock + testes + build
- `rm package-lock.json && npm install` (ou `bun install` se o projeto for bun-first — vou verificar antes; Lovable padrão é bun, então pode ser `bun install` + manter `package-lock` removido).
- Adicionar testes vitest mínimos em `src/test/`:
  - `portalFinancialMasking.test.ts` (mocka supabase, garante mascaramento).
  - `statusMappers.test.ts` (helpers da Fase 3).
  - `finalizeDelivery.test.ts` (mock supabase rpc — verifica payload).
- Os testes de RLS/storage reais exigiriam um Supabase de teste — vou marcar como **manual checklist** documentado em `docs/hardening-checklist.md` em vez de Deno tests automáticos (mais honesto que fingir cobertura).

---

## Pontos que precisam de decisão sua antes de eu começar

1. **Padrão de status de parada**: `arrived` único ou `arriving`+`in_progress`? (vou assumir o segundo se não responder)
2. **Auto-criar tenant**: posso remover totalmente do `useTenant` e exigir que onboarding novo passe por uma página/botão "Criar empresa"? Ou prefere manter mas com guardas mais fortes?
3. **Bucket `receipts`**: confirmar que o path real usado em uploads é `{tenant_id}/...` (vou verificar no código antes de aplicar a migration). Se for outro layout, ajusto.
4. **Escopo dos testes**: ok aceitar testes unitários + checklist manual, ou quer que eu invista em testes de integração contra um Supabase efêmero?
5. **Ordem de entrega**: começo pela Fase 1 (segurança) sozinha e te entrego para revisão antes de seguir, ou toco Fases 1+2 juntas?

Responda essas 5 e eu começo pela Fase 1.
