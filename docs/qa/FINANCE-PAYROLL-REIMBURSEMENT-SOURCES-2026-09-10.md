# Deduplicação de reembolsos na geração de folha

Data: 2026-09-10. Implementação local; nenhuma aplicação remota.

## Mudança

Migration `20260910132406_finance_payroll_reimbursement_source_dedup.sql`, criada pela CLI, conserva a assinatura e os controles já presentes na definição instalada de `generate_payroll_period`. Acrescenta verificação de estado antes da geração e deduplicação transacional antes do retorno. Não modifica comandos de pagamento, despesas, custos consolidados ou interface.

A identidade de origem é explícita:

- `driver_settlement_items.settlement_id = driver_settlements.id`;
- `item_type = expense`, `source_table = driver_expenses`, `source_id = driver_expenses.id`;
- snapshot do item com `approval_status = approved` e `reimbursable = true`;
- item de folha `driver_settlement`, natureza `credit`, `source_table = driver_settlements`, `source_id = settlement.id`;
- item duplicado `driver_expense_reimbursement`, natureza `credit`, `source_table = driver_expenses`, `source_id` exatamente igual ao da composição do acerto.

IDs, empresa e motorista devem corresponder. A soma dos itens identificados deve coincidir com o reembolso total declarado pelo acerto e não pode haver IDs duplicados. Valores iguais ou datas próximas nunca determinam identidade. Se a composição não puder ser demonstrada, a geração inteira falha com exigência de revisão.

Somente a linha automática de reembolso duplicada da folha em geração é removida. O crédito agregado do acerto conserva o valor aprovado. Cada crédito passa a guardar `source_metadata.reimbursement_sources` com os IDs e valores cobertos. Essa cobertura congelada é prioritária na comparação com folhas futuras; os itens atuais mutáveis de um acerto não substituem o histórico. Créditos históricos sem essa cobertura exigem revisão explícita antes de gerar outra folha de acerto/reembolso do mesmo empregado.

## Remuneração, pagamentos e estados

Salário e demais itens de remuneração permanecem intactos. `driver_settlement_payments.id` continua sendo a fonte de `driver_settlement_payment/already_paid`. `employee_advances.id` continua sendo a fonte distinta de `driver_advance/already_paid`. Nenhum pagamento ou adiantamento é criado, removido ou alterado.

Folhas `draft`/`calculated` podem ser regeneradas. Uma entrada `approved`/`locked`/`closed` impede regeneração mesmo que o período esteja em estado editável. Períodos `approved`, `closed` e `under_review` impedem nova geração para as mesmas datas. Folhas canceladas sem pagamento efetivo de título não reservam a fonte eternamente e permanecem preservadas quando se gera uma substituta. Se houver pagamento ativo em título de folha, cancelamento não elimina a realidade do dinheiro: a substituição exige revisão, inclusive quando a origem reaparece em outro mês.

Conflitos entre períodos ativos não são resolvidos por subtração de valores: uma despesa já creditada em janeiro e reapresentada pelo acerto de fevereiro interrompe a geração de fevereiro. A história de janeiro fica intacta. O caminho inverso, despesa já incluída em crédito de acerto e depois apresentada separadamente, também é bloqueado.

## Verificação

`npx vitest run src/test/financePayrollReimbursementSources.test.ts`: 17 testes de integração SQL passaram em PGlite. O teste instala tabelas/defaults e funções reais de geração e recomposição extraídos da baseline, com dependências sintéticas de autenticação e pagamentos ativos. Asserções conferem valores, IDs, estados e snapshots completos antes/depois de rejeições.

Casos cobertos: composição exata; despesa fora do acerto; mesmos valores com IDs diferentes; regeneração idempotente do período; salário preservado; pagamento e adiantamento separados; approved/closed/under_review; entrada aprovada/bloqueada em período calculado; conflitos nos dois sentidos entre meses; snapshot histórico após mudança no acerto; histórico sem cobertura; cancelamento sem pagamento; cancelamento com pagamento nas mesmas datas e em mês seguinte; composição sem ID; motorista proibido.

## Limitações para integração

Não é ensaio integral de implantação nem validação concorrente nativa de geração versus aprovação/cancelamento. O advisory lock financeiro serializa gerações compatíveis e os períodos são bloqueados para atualização, mas a matriz de concorrência com os escritores legados de folha ainda precisa ser ensaiada antes da implantação.

Folhas antigas já aprovadas com duplicidade não são corrigidas automaticamente. A resolução exige representação auditada das fontes históricas e tratamento separado dos pagamentos realmente efetuados. O erro `finance_payroll_historical_source_review` deliberadamente impede considerar uma composição atual como prova do que uma folha antiga consumiu.

A camada de custos continua com sua classificação atual: isto corrige duplicidade de obrigação na folha, sem classificar créditos agregados de acerto como remuneração. Reabertura, resolução de conflitos históricos, folha cancelada paga e transporte de saldo permanecem trabalhos próprios de integração.
