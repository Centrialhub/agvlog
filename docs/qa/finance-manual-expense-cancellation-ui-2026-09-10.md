# Cancelamento de despesa avulsa — UI — 10/09/2026

`ManualExpenseCancellationReview` integrado à lista RecordedCosts somente quando source=manual_expense. A identidade é row.id=payable_id; não cria item de lote nem usa request_id como título. Gastos em lote mantêm sua ação anterior e folha não recebe nenhuma dessas ações.

Prévia independente por empresa/ator/título via preview_finance_manual_expense_cancellation. Schema valida identidade do título, pedido original e evento; elegibilidade requer fonte e efeitos completos. Exibe valor original, favorecido, título e pedido original, descrição/motivo/documento e autor/data preservados; comprovantes utilizam ExpenseReceiptDialog. Cancelamento manual permanece visível com autor/ID, data, motivo e evento.

Efeitos separados: custo retirado dos indicadores, obrigação cancelada e dinheiro inalterado. Exige motivo, declaração e revisão antes de confirmar cancelamento definitivo. Vínculos/pagamentos históricos, materializações e fechamento impedem decisão conforme autoridade do servidor. Não oferece estorno, novo pagamento ou reversão automática de dependências.

Pedido salvo por empresa/ator/payable antes de enviar. Resposta incerta permite somente retomada do mesmo pedido, inclusive se uma tentativa posterior trouxer rejeição conhecida. Corrupção do armazenamento bloqueia novas decisões. Rejeição conhecida na primeira tentativa permite revisar novamente. Contexto em atualização/falha não exibe valores antigos nem libera nova confirmação.

Validação: 10 testes passaram (6 fluxo UI, 3 cliente/schema, 1 escopo de integração). ESLint dos8arquivos aprovado. Nenhum SQL ou escritor financeiro alterado; 81257core e 81549reader são responsabilidade dos demais agentes. TSC coordenado separadamente.

Novos arquivos: manualExpenseCancellationContract.ts, manualExpenseCancellationClient.ts, ManualExpenseCancellationReview.tsx, manualExpenseCancellationReview.test.tsx e manualExpenseCancellationClient.test.ts. Integrações: RecordedCosts.tsx, expenseCancellationIntegration.test.tsx e financeAuditContract.ts (manual_expense_cancelled).

TSC integrado48196 concluído com exit0; log finance-manual-expense-cancellation-ui-tsc.log vazio. Label finance_dependency_busy também incluído no cancelamento canonical expenseCancellationContract.ts; lint de ambos os contratos aprovado. Nenhum processo TSC ativo.
