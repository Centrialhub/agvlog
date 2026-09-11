# Conciliação com movimentos ativos — 10/09/2026

Migration CLI: `20260910183442_finance_reconciliation_active_movements.sql`.
SHA256: `1ace7642c0c66c131627b5d860f0289782d8b5ff2c48bc2e21d96dc0ad206ac8`.

## Entrega

As definições efetivas de `reconciliation_context`, `reconciliation_snapshot_internal`, `reconciliation_options`, `process_automatic_reconciliation` e `reconciliation_evidence_issue` passam a consultar `finance_private.active_movements` onde selecionavam dinheiro operacional. O patch exige que cada definição contenha a consulta esperada e falha se o contrato desaparecer. Tipos de registro, snapshots gravados e reversões não são substituídos.

O contexto de uma seleção invalidada rejeita `finance_reconciliation_selection_unavailable`. A associação manual chama esse contexto depois de obter a trava financeira, portanto uma seleção anterior não autoriza a associação nova. A automação compara referência, dia, valor, sentido e conta entre candidatos ativos; movimentos brutos invalidados não competem com o único candidato ativo.

O trigger BEFORE INSERT de `finance_reconciliation_groups` rejeita IDs ausentes, estrangeiros, repetidos ou invalidados com `finance_reconciliation_movement_inactive` (23514). Usa `pg_try_advisory_xact_lock` por tenant e rejeita disputa com `finance_dependency_busy` (40001), evitando que um writer residual segure uma linha enquanto espera a trava financeira. Não cria grants públicos. O worker mantém sua verificação de autorização do iniciador. A autenticação do RPC manual continua na definição existente e no contexto consultado depois da trava.

O histórico mantém decisões e seus snapshots; retorna `evidence_issue=movement_inactive` quando um movimento associado não está ativo. O schema e a mensagem central em `reconciliationHistoryContract.ts` reconhecem o código. A reversão existente permanece disponível. Nenhuma linha de extrato é modificada.

## Validação executada

`npx vitest run src/test/financeReconciliationVoidedMovements.test.ts src/test/reconciliationHistory.test.tsx`: **10 testes passaram** (5 SQL/PGlite e 5 UI existentes). ESLint dos arquivos TS alterados: zero erros.

A fixture deriva de `setupFinanceStatementIntakeDatabase`, aplica a cadeia real de intake, verificação, conta nativa OFX, conciliação, automação e reautorização142923, depois182541/182830/183442. A verificação usa bytes OFX sintéticos, parser e worker reais. Não comprova autenticidade de documento externo ou cobertura de um período real.

Casos SQL: seleção anterior invalidada; candidato só invalidado não concilia automaticamente; dois registros brutos com mesma referência mas apenas um ativo permitem uma única conciliação; snapshots/histórico preservados e reversão real; INSERT residual rejeitado; motorista, motorista/admin misto e tenant estrangeiro excluídos. Respostas de opções e histórico passam pelos schemas reais da UI.

## Limites e pendências

- Anulação é inserida explicitamente pelo owner da fixture, com comando `qa_void_storage`; **não existe comando público de void nesta entrega**.
- Para o teste de referências duplicadas, o segundo movimento também é inserido pelo owner: `record_movement` ainda rejeita a referência original com `finance_reference_already_recorded`. Sua adaptação é outra frente.
- Um teste insere void após conciliação para simular inconsistência histórica e provar visibilidade/reversão. Isso não autoriza o futuro comando a invalidar dinheiro conciliado. O comando deverá bloquear dependências e compartilhar a trava financeira; ausência dessa implementação impede alegar concorrência completa void × conciliação.
- Sem ensaio PostgreSQL nativo nesta rodada; o comportamento concorrente específico deste trigger ainda não foi exercitado por duas sessões. PostgreSQL permanece parado.
- Não foram modificados saldo de conta, abertura, snapshots de fechamento, writers de despesas/pagamentos ou tabelas bancárias legadas. A fixture é um grafo restrito de dependências reais, não ensaio de todas as migrations do projeto.
