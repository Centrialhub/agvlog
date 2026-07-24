## Objetivo

Rodar uma vistoria funcional completa do app do motorista (`/driver/*`) e um smoke test end-to-end, sem criar funcionalidades novas. Foco em identificar quebras de contrato entre UI, hooks, RLS e Realtime, e corrigir apenas o que estiver realmente quebrado.

## Escopo

Páginas cobertas (todas em `src/pages/driver/`):
- `DriverHome` — resumo + estado vazio (`NoLoadsHelp`)
- `DriverStops` — paradas do trip ativo
- `DriverDeliveries` — entregas + assinatura (`SignaturePad`) + foto/POD
- `DriverIssues` — abertura de ocorrência
- `DriverJourney` — jornada / início e fim de turno
- `DriverExpenses` — despesas + upload de recibo (bucket privado)
- `DriverChecklist` — checklist pré/pós viagem
- `DriverEvents` + `DriverEventDetail` — timeline de eventos operacionais
- `DriverChat` — mensagens diretas motorista ↔ operação

Componentes de apoio: `DriverLayout`, `DemoBanner`, `DriverDeliveryMap`, `DriverLoadNotes`, `NoLoadsHelp`, `SignaturePad`.

Hooks e libs sob revisão: `useCurrentDriver`, `useActiveTripsLive`, `useDriverMessages`, `useOperationalChecklists`, `useOperationalEvents`, `useIncidents`, `useLoadItems`, `driver/demoMode.ts`.

## Passo a passo

1. **Vistoria estática (read-only)**
   - Ler cada página `driver/*` + hooks acima e checar:
     - Uso de `useCurrentDriver()` como única fonte de `driver_id` (nunca fallback por tenant).
     - Queries sempre com filtro `driver_id` (respeita RLS `get_my_driver_id()`).
     - Subscrições Realtime dentro de `useEffect` com `removeChannel` no cleanup.
     - Sentinelas Radix (`__none__` / `__unmapped__`) convertidos para `null` antes do insert.
     - Estados vazio/carregando/erro presentes e sem loading infinito (timeout defensivo já padronizado).
   - Conferir `App.tsx`: todas as rotas `/driver/*` protegidas por `<DriverRoute>` e envelopadas em `<DriverLayout>`.

2. **Contratos de banco**
   - Confirmar colunas esperadas por cada hook contra o schema atual (`dispatch_trips`, `dispatch_stops`, `dispatch_events`, `driver_expenses`, `operational_checklists`, `checklist_executions`, `incidents`, `driver_direct_messages`, `proof_of_delivery`, `loads`).
   - Validar policies RLS via `supabase--read_query` para as tabelas acima: `SELECT/INSERT/UPDATE` devem exigir `driver_id = get_my_driver_id()`.
   - Confirmar `GRANT`s ao role `authenticated` em cada tabela usada pelo app.

3. **Realtime**
   - Verificar publicação `supabase_realtime` inclui `loads`, `dispatch_trips`, `dispatch_stops`, `dispatch_events`, `driver_direct_messages`.
   - Checar canais em `useActiveTripsLive` e `useDriverMessages` (subscribe + cleanup).

4. **Smoke test automatizado (Playwright headless)**
   - Login com sessão managed (`LOVABLE_BROWSER_SUPABASE_*`) mapeada a um usuário motorista de teste.
   - Fluxo em uma corrida: abrir `/driver` → verificar Home → navegar Stops → abrir uma entrega → capturar foto simulada + assinatura → registrar despesa → abrir ocorrência → enviar mensagem no chat → confirmar checklist.
   - Screenshot em cada etapa em `/tmp/browser/driver-smoke/`.
   - Registrar erros de console e chamadas HTTP com `status >= 400`.
   - Se `LOVABLE_BROWSER_AUTH_STATUS != injected`, pular smoke e reportar como bloqueio (não falha do app).

5. **Testes unitários existentes**
   - Rodar `bunx vitest run` focando em `rlsDriverLoads.test.ts`, `rlsCrossTenant.test.ts`, `stopConsolidation.test.ts`, `driverMonitoring.test.ts`.
   - Não adicionar novos testes nesta rodada, apenas garantir que os existentes continuam verdes.

6. **Relatório de achados**
   - Matriz por página: `[rota] · status · achado · severidade · correção sugerida`.
   - Separar “bugs reais” (quebra runtime, RLS frouxa, loading infinito) de “observações” (UX, cópia, ícones).

7. **Correções mínimas**
   - Aplicar apenas patches pequenos para bugs reais encontrados (ex.: filtro faltando, cleanup de canal, sentinela não convertido, `driver_id` implícito).
   - Nenhum refactor estético, nenhuma nova feature.
   - Cada correção acompanhada de teste ou verificação manual via smoke.

## Detalhes técnicos

- Fonte de verdade do driver: `useCurrentDriver` → mapeia `auth.uid` para `drivers.id` e trip ativa.
- RLS relevante: função `get_my_driver_id()` já usada em policies das tabelas do workspace do motorista.
- Realtime já habilitado para `loads` e `dispatch_trips`; confirmar demais tabelas em uso.
- Recibos: bucket privado, acesso via signed URL (`get-client-pod-signed-url` e equivalente para expenses).
- Demo mode: `canUseDriverDemo` só em `import.meta.env.DEV` — produção deve mostrar empty states, nunca dados fake.

## Entregáveis

- Relatório em chat com matriz de achados por página.
- Screenshots do smoke test (Playwright) anexados via `code--view`.
- Lista de correções aplicadas (se houver) com diffs pequenos e justificativa.
- Confirmação de que build, lint e testes existentes seguem verdes.

## Fora do escopo

- Novas telas, novos fluxos ou redesenho visual do app motorista.
- Alteração de schema além do estritamente necessário para corrigir bug real.
- Mudanças no portal do cliente, backoffice ou pipeline SSX.
