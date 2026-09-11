# Histórico de movimentos invalidados — UI — 10/09/2026

Entrega somente de leitura. `movementListSchema` agora exige contagens ativas/invalidadas, valores históricos/invalidados e situação por linha; não presume ativo quando falta migration. Valida coerência entre totais ativos+invalidados e históricos, contagens, tenant/ID do movimento e referências por tipo void/duplicate/replacement.

`FinanceMovements` mantém todas as linhas devolvidas pelo leitor histórico. Cards usam apenas valores ativos calculados no servidor, contagem histórica e invalidada separadas; detalhes exibem entradas/saídas originais e invalidadas. Cada evento mostra permanentemente autor nome/ID, data, motivo, movimento original e referência de duplicidade/substituição. IDs de evento/pedidos ficam nos detalhes. Valor da linha rotulado original. Consulta em atualização/falha oculta dados antigos.

Nenhum botão de invalidar, substituir, reativar, estornar ou comando novo. Vínculos com recebíveis permanecem disponíveis como consulta separada. Nenhum comprovante ou snapshot congelado alterado.

Arquivos: src/lib/financial/ledgerContract.ts; src/components/financial/MovementInvalidationHistory.tsx (MovementInvalidationHistory e MovementListTotals); src/pages/FinanceMovements.tsx; src/test/movementInvalidationHistory.test.tsx.

Validação: 7 testes passaram (4 UI/schema e3leitor SQL real financeMovementCorrectionHistory do coordenador). Lint dos4arquivos aprovado. Fixtures antigas não importam o schema de lista atual; financeLedgerDatabase usa resposta raw e não precisou receber DDL duplicada. Nenhum SQL alterado. TSC coordenado separadamente.

TSC integrado22167 terminou exit0; log finance-movement-invalidation-history-ui-tsc.log vazio. Nenhum TSC ativo. Coordenador também confirmou10testes integrados (foundation3, history3, manualreader4) e lint aprovados.
