# Fresh recebíveis: inline e ledger delegado — 2026-09-11

Arquivos pendentes011121 e025658 corrigidos por autorização explícita do coordenador. Rollouts já aplicados em produção não foram alterados. Arquivos anteriores guardados em docs/qa/*before-delegated-fix.sql; hashes antigos/novos e hashes de contrato inline constam finance-receivable-fresh-rebaseline-2026-09-11.json.

NovosSHA256:
-011121:3655553151f1d61c328c636cc3e16ca7155d11e85b6b0521f171f1edab1719e7.
-025658:fa548e79da43d1e6ec083cd20bcb1765812e5afd8cb7dc84447c19ac0d1b9745.

Sem helper _receivable_ledger_evidence, aceita somente snapshot inline conhecido por prosrc/SECURITY INVOKER/ACL privada. Com helper, aplica exatamente o trecho de compatibilidade guardada previamente testada: créditos e correções são excluídos do saldo delegado, histórico preservado no snapshot. Não se aceita corpo desconhecido por mera presença de um SUM, nem se aplica regra parcial em snapshot delegado sem helper.

Testes:19casos financeReceivableMovementProjection (contrato inline) aprovados;4financeFreshReceivableDelegation aprovados (correction/reuse sem novo dinheiro, cancelamento fiscal pago→crédito preservado, negação de segunda liberação e dois arquivos arquivados reproduzindo falhas/rollback). FreshForwardIntegration mais1PASS instala a cadeia financeira inteira até140010 usando011121/025658/133352 da pasta migrations, sobre192908 lifecycle inteiro. Manifesto exato finance-fresh-forward-manifest-2026-09-11.json. Lint passou.

Arquivos de teste/helper novos são próprios; rollouts de produção, helpers do core e migrations externas não foram alterados. Nenhuma emissão fiscal real, escrita remota, PostgreSQLnativo ou TSC. Emissão/cancelamento no teste são fixtures sintéticas com worker real, sem chamar provedores.

Limites: cadeia financeira e dependências selecionadas reais em PGlite, não reset integral Supabase; operacional/workspace externo fora do intervalo financeiro, Auth/Storage de fixture e cron ausente seguem limites já registrados. Não se declara toda stackfreshhomologada; somente as incompatibilidades011121/025658/133352 reproduzidas foram resolvidas e testadas.
