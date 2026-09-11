# Resumo completo de custos canônicos

Migration criada via CLI `20260910152557_finance_recorded_cost_summary.sql`. Sem execução remota. Não altera livro financeiro, comandos de pagamentos ou a consulta paginada existente.

RPC `get_finance_recorded_cost_summary(_tenant_id uuid, _from date default null, _to date default null, _category text default null, _cost_center text default null)`. Centro aceita UUID da empresa, `unassigned` ou null. Datas finitas e categoria até100 caracteres; nenhuma paginação/cap de linhas.

Contrato v1 publicado à UI: filtros, cobertura `recorded_batches_manual_and_payroll_remuneration`, `coverage_complete=false`, `excludes_bank_cash=true`; contagens total/cancelados/inválidos/créditos de folha não classificados/data de registro; `totals_valid`, `total_cents`; grupos de categoria, centro e mês com item_count e amount_cents string. Categorias ou meses desconhecidos preservam null. Todos os valores dos grupos e total ficam nulos se qualquer custo ativo no filtro for indeterminado.

## Semântica preservada

Mesmas famílias canônicas da função recorded_costs30032: itens de lote; comandos record_manual_expense com seus títulos; remuneração credit da folha aprovada/fechada (base_salary, daily, hourly, commission, bonus). Manual é excluído por ID exato quando o título já aparece no lote. Pagamento de título, saída bancária, adiantamento already_paid e descontos não são adicionados como novos custos. Cancelamento de título manual retira seu custo da soma e mantém contagem.

Créditos de folha que não podem ser classificados como remuneração permanecem diagnosticáveis e invalidam o total do filtro relevante. Inclui reembolso/acerto sem decomposição segura por fonte: não presume que seu valor inteiro é novo custo. Pais de folha ausentes/fora da empresa também não autorizam perda silenciosa desses créditos.

Lote usa data de despesa; manual usa competência explícita ou dia São Paulo do registro; folha usa competência ou início do período. Data inválida não desaparece sob filtro temporal, fica indeterminada. Não agrega custos por data de pagamento.

## Cobertura explicitamente incompleta

`excluded_sources`: legacy_driver_expenses, maintenance_orders, settlement_composition, payroll_reimbursements_and_advances. A cadeia canônica25357/30032 não contém mapa inequívoco de manutenção ou de todas as despesas antigas para seus custos canônicos; somar tabelas operacionais pode duplicar custo já lançado em lote/manual. Por isso não inclui seus valores e não apresenta cobertura global completa. Uma manutenção registrada como custo canônico já integra a soma por essa fonte; o registro operacional da manutenção não é somado novamente.

## Validação

Oito testes SQL PGlite passaram em `financeRecordedCostSummary.test.ts`, com parser real `recordedCostSummarySchema` em todas as respostas. Fixture `recordedCostSummaryDatabase.ts` reutiliza baseline/cadeia real do livro e dos vínculos, e instala as consultas existentes para comparação semântica. Casos:1005 custos, grupos completos, deduplicação porID, cancelados, limites São Paulo, filtros categoria/centro, outro tenant excluído, invalidade global/data infinita, remuneração sem duplicar adiantamentos/contas a pagar, reembolso/acerto não classificado, motorista/perfil misto, parâmetros inválidos. ESLint do teste/helper passou.

Não houve ensaio de carga em produção, nem integração de todas as fontes operacionais antigas. A consulta agrega o tenant completo antes de responder; nenhuma amostra500 é usada como total. A validação não certifica saldo bancário nem fechamento.
