# Promoção pública de invalidação — PostgreSQL nativo — 10/09/2026

192831 SHA256 `c90da6bb84d7733b920b818f78761b3d8bb3fce53e255a3b6371d4381d536595`.191905 permanece `6f57f662c965f24ccc010973232ea16b9ed44d0eed8480f0a47a72524237039b`.

Script `scripts/test-finance-public-movement-void-native-cases.mjs`; selector `finance-public-movement-void`; log `node_modules/.cache/qa-postgres/finance-public-movement-void-native-2026-09-10.log`.

## Casos

1. `public.void_finance_manual_movement` executado sob `authenticated`, identidade financeira real. Previeweligible/can_execute true e resultado são validados pelos schemas reais. Replay é idêntico; um único void; original intacto; preview posteriorcan_execute false.
2. A função original privada continua semEXECUTE paraauthenticated. Anon e service_role não executam o wrapper público.
3. Replay público esperando financeadvisory revalida acesso depois da revogação e é recusado.
4. Trigger real desativado torna previewcan_execute false. Pedido com revisão antiga é recusado40001/finance_movement_correction_changed; pedido com revisão atual é recusadofinance_movement_correction_blocked. Nenhum void residual. Restaurar trigger restaura disponibilidade do preview.

A primeira execução22250 encerrouexit1/stopped porque o teste esperava runtime_not_ready em vez da rejeição correta por revisão obsoleta. Corrigida exclusivamente a expectativa do teste e acrescentada validação com a revisão atual. Nenhuma alteração SQL de produto.

## Limites

Reutiliza grafo nativo de90516/191905, com dependências reais e limites de schema herdados das factories focadas. Não equivale ao ensaio completo de todas as migrationsSupabase. A execução local promove os grants conforme a migration; não altera grants de teste para facilitar o caminho. Sem autenticaçãoHTTP, browser ou transação bancária externa. Nenhum acesso remoto.

Resultado final: **4 testes passaram** em PostgreSQL17.11. Handle40947 terminouexit0; servidor parado pelo finally do runner.
