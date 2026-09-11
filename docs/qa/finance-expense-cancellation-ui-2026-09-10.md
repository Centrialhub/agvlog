# Cancelamento auditado de gastos de lote — UI — 10/09/2026

Implementado `ExpenseCancellationReview` com consulta por empresa, ator e ID de `finance_expense_items`. Entrada no detalhe de gastos em lote e na lista de custos apenas para a origem `expense_batch`; despesas avulsas e remuneração da folha não recebem essa ação.

A revisão separa custo retirado dos indicadores, obrigação a cancelar e dinheiro preservado. Exige motivo e declaração explícita, seguida de confirmação; não cria transferência, pagamento ou substituição automática. O cancelamento é definitivo. Dependências impedem o envio e aparecem com explicações e referências por ID. Desfazer vínculos históricos não é apresentado como liberação automática.

Pedido preservado por empresa/ator/gasto antes da chamada, com retomada integral após resposta incerta; armazenamento inválido bloqueia novas decisões. Rejeição transacional conhecida na primeira tentativa libera revisão; pedidos previamente incertos permanecem preservados. Falha/refetch da consulta oculta dados obsoletos e revisão exige a versão atual.

Histórico continua exibindo o gasto original, comprovante, autor/ID, data, motivo e evento manual. Contrato `expenseHistorySchema` exige os novos campos de situação e contagem do leitor75733; totais e categorias ativos vêm do servidor, sem subtração local. Custos cancelados permanecem na listagem com exclusão explícita dos totais. Label de auditoria: expense_cancelled.

Validação: 12 testes passaram (5 fluxo UI, 3 cliente/contrato, 1 integração de escopo e 3 leitores SQL reais do coordenador). ESLint dos 11 arquivos do escopo aprovado. TSC integrado55344 terminou exit0; log `finance-expense-cancellation-ui-tsc.log` vazio. Depois do TSC foi acrescentado somente o detalhamento legível dos IDs de dependências, validado por lint.

Arquivos novos: expenseCancellationContract.ts, expenseCancellationClient.ts, ExpenseCancellationReview.tsx, expenseCancellationReview.test.tsx, expenseCancellationClient.test.ts e expenseCancellationIntegration.test.tsx. Integrações: ExpenseHistoryDetail.tsx, RecordedCosts.tsx, FinanceExpenses.tsx, expenseHistoryContract.ts e financeAuditContract.ts.

Banco/projeções pertencem ao core e ao coordenador, sem SQL editado nesta entrega e sem implantação remota. O teste histórico financeExpenseBatchDatabase importa o schema atual mas instala banco antigo; coordenador informado para atualizar sua configuração de banco sem relaxar o contrato de produção. A elegibilidade vem do servidor e requer título aberto exato; não existe nesta etapa cancelamento de despesa avulsa ou resolução automática de pagamentos, descarga, folha, acertos protegidos e relações históricas.
