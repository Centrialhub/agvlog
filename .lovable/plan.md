
# Smoke Test — Pós-correções portal do cliente

Rodada curta de verificação após as últimas mudanças (RPCs `_v2` de portal + Realtime de mensagens). Sem alterar código de produto.

## Escopo

1. **Build & Tipagem**
   - `bun run build` (Vite)
   - `bunx tsgo --noEmit` (verificar contratos após os novos RPCs `_v2`)

2. **Testes automatizados**
   - `bunx vitest run` (esperado: 250/250 passando)

3. **Banco / RPCs novos**
   - Confirmar via `supabase--read_query` que existem:
     - `get_client_portal_alerts_v2`, `get_client_portal_upcoming_deliveries_v2`, `get_client_portal_tracking_v2`
     - `client_occurrence_messages` presente em `pg_publication_tables` para `supabase_realtime`
     - `REPLICA IDENTITY FULL` na tabela
   - Chamar cada RPC `_v2` com `_client_id = NULL` para confirmar que retorna erro `client_id is required` (fail-closed).
   - Chamar cada RPC `_v2` com um `_client_id` inválido (não vinculado ao user) para confirmar que `_portal_assert_client_access` bloqueia.

4. **Runtime da aplicação (Playwright headless)**
   - Rotas públicas: `/auth` responde 200.
   - Rotas do portal (`/portal`, `/portal/tracking`, `/portal/alerts`, `/portal/upcoming`, `/portal/occurrences`) — sem sessão devem redirecionar para `/auth`; capturar screenshots.
   - Console/network: nenhum erro 4xx/5xx em rotas públicas; nenhum `get_client_portal_*` chamado sem `_client_id`.

5. **Regressão UI mínima**
   - `/team` e `/drivers`: apenas verificar que carregam sem erro de console (dependem da edge function `list-tenant-members`, já corrigida em rodadas anteriores).

## Entregável

Relatório curto por seção com PASS/FAIL, saídas relevantes (contagem de testes, resultado das queries) e screenshots das rotas do portal em `/tmp/browser/smoke/`.

## Não incluso

- Fluxos autenticados end-to-end do portal (não há `client_portal_access` provisionado neste ambiente — já reportado).
- Emissão real de CT-e via Hub Fiscal.
- Mudanças de código; qualquer falha vira novo ticket.
