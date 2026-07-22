## Objetivo

Smoke test do app do motorista: verificar que os vínculos (auth → driver → tenant → veículo → carga → viagem) e as funcionalidades básicas seguem funcionando após as últimas mudanças (autofill driver, remoção do filtro `tenant_id`, Realtime, kanban on_hold, romaneio).

## Escopo do smoke test

Automatizado via Playwright headless em `localhost:8080`, usando a sessão Supabase injetada (`LOVABLE_BROWSER_AUTH_STATUS=injected`). Além disso, checks SQL diretos via `supabase--read_query` para validar vínculos no banco. Nenhuma escrita, nenhuma migração.

### 1. Vínculos (SQL, read-only)

- `drivers`: contar motoristas ativos com `user_id` NOT NULL vs NULL do tenant atual — surface de "sem app".
- `loads` recentes (últimos 14 dias) com `driver_id IS NULL` mas veículo com `current_driver_id` — indicativo de trigger `trg_loads_autofill_driver` falhando ou linhas anteriores ao backfill.
- Cargas com `driver_id` preenchido mas motorista sem `user_id` — visível para operador, invisível no app.
- Cargas com `on_hold=true` — não devem aparecer no app.
- Viagens `dispatch_trips` `planned/in_progress` sem `driver_id` ou órfãs de `loads`.
- `tenant_memberships`: motoristas com `user_id` mas sem membership no tenant da carga.
- Realtime publication: confirmar `loads` e `dispatch_trips` em `supabase_realtime`.

### 2. Fluxo do app do motorista (Playwright)

- Restaurar sessão (cookies + localStorage) e navegar para `/driver`.
- Verificar renderização da home (`DriverHome`): título, seção "Cargas atribuídas" ou `NoLoadsHelp` conforme estado.
- Se houver carga: expandir `DriverLoadNotes`, checar contagem de NFs, presença do botão "Romaneio".
- Verificar Realtime: sem erros no console relacionados a `channel`/`subscribe`.
- Navegar para `/driver/deliveries` e `/driver/expenses` (smoke — só carregar, sem submeter).
- Coletar console errors/warnings e requests com status ≥ 400.

### 3. Diagnóstico automático (usando o próprio `NoLoadsHelp` como referência)

- Para o motorista da sessão, replicar o probe SQL: cargas visíveis por RLS ignorando tenant/status, comparado com o que o app efetivamente mostra. Discrepância = bug.

## Entregável

Relatório resumido com:
- Tabela "Vínculos": OK / Alerta / Falha para cada check SQL, com contagens.
- Tabela "Fluxo UI": passos executados, screenshots-chave, erros de console/rede.
- Lista priorizada de anomalias reais (com file:line ou row ids) e sugestão mínima de correção.

Sem alteração de dados nem de código. Só leitura + navegação. O relatório indica se algum item exige nova rodada de correção.

## Verificação

O próprio smoke é a verificação. Passo final: se todos os checks passarem, declarar "app do motorista estável para o motorista sob teste". Se falhar, abrir plano corretivo separado.
