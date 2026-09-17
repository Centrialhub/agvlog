# Validação local A–D —171503 até185517

Execução em2026-09-11, arquivos atuais, Vitest3.2.7/PGlite, maxWorkers=1 e sem paralelismo de arquivos. Sem alteração de SQL/produto, sem remoto, Sites, TSC ou PostgreSQL nativo.

## Resultado comprovado

- Primeira execução:19arquivos,100testes passaram, saída0, duração48.02s. Log integral `finance-ad-existing-sql-tests-2026-09-11.log`.
- Complemento de comandos:2arquivos,18testes passaram, saída0, duração5.07s. Log `finance-ad-cancellation-command-tests-2026-09-11.log`.
- Total:21arquivos,118testes, nenhuma falha/cancelamento reportados.

## Cobertura exercitada

A: financeStockConsumption, stockConsumptionReaders, financePaidProjectionChains, paidProjectionRealClose. Comandos/reversões e cálculo de atribuição; seleção através de páginas; pagamentos/materializações e fechamento real no respectivo fixture.

B: financeCashPeriodClose, cashPeriodCountReaders. Contagem/fechamento e histórico, permissões e bloqueios.

C: financeExpenseCancellation, financeManualExpenseCancellation, expenseCancellationReaders, manualExpenseCancellationReaders, payablePortfolio, payablePortfolioCancellation. Comandos reais append-only e consultas; efeitos nas obrigações/custos, dependências impeditivas, saldo da carteira e identidade/autorização.

D: financeMovementCorrectionFoundation, financeMovementCorrectionHistory, activeMovementPeriodProjections, financeActiveMovementFinancialGuards, financeActiveReceiptMovementGuards, financeMovementActiveReference, activeMovementOptions, financeVoidAwareMonetaryProofs, movementRecordingOrigin. Preservação de históricos, efeitos nas projeções/fechamento, uso novo bloqueado, consultas de candidatos e prova comando/evento/origem.

Arquivos são `src/test/<nome>.test.ts`. Comandos completos constam na chamada de execução da tarefa; primeira execução lista os19arquivos acima, complemento os2comandos de cancelamento. Nenhum teste foi enfraquecido ou modificado para passar.

## Limites importantes

Os testes usam helpers existentes que instalam SQL real e exercitam consultas/comandos, mas também contêm fixtures operacionais delimitadas. Não representam uma única instalação de todo o baseline de produção. A aprovação destes118testes não comprova ausência de colisões de migrations na cadeia inteira, nem locks/concurrency reais entre sessões PostgreSQL, daemon cron, APIs remotas ou UX publicada.

O agente bank_period_evidence confirmou helper compartilhado `createFinanceForwardBlockDatabase(endExclusive,true)` e ensaio anterior até170539; está estendendo a cadeia global. Não houve modificação paralela desse helper nesta subtarefa. As reafirmações de RLS/grants173336/180245 devem ser verificadas também no ensaio integral e após instalação, pois fixtures por domínio podem não instalar migrations de reafirmação posteriores.

Manter revisão estática e manifesto `finance-remaining-171503-224136-*` como ordem/hash, sem confundir testes de domínio com autorização de ativação. Gate/cron/claims ainda exigem verificações do coordenador na etapa apropriada.
