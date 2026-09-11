# Correção auditada de gasto em lote: proposta de interface

Revisão somente leitura de produto/código em 2026-09-10. Nenhuma implementação de cancelamento nesta entrega.

## Pontos existentes

- `/financial/recorded-expenses` → `FinanceExpenses.tsx` → `ExpenseHistoryDetail.tsx`. O detalhe recebe uma cópia da linha selecionada; não consulta elegibilidade/revisão por ID. Hoje mostra categoria/valor/comprovante, envios, complemento, descarga e eventos, mas não a situação do próprio gasto.
- `expenseHistoryContract.ts` e `list_finance_expenses` não apresentam cancelamento do item nem separação explícita entre contagem histórica e KPIs ativos. Os totais atuais são rotulados como todos os gastos do filtro.
- `RecordedCosts.tsx` já apresenta cancelados preservados e excluídos do total. Porém o produtor atual da família `expense_batch` define cancelled=false; o suporte visual existente não resolve sozinho o cancelamento de finance_expense_items.
- O histórico do detalhe já possui actor_id/actor_name/reason/created_at, mas exibe só nome e traduz apenas recorded. Deve mostrar rótulo legível de cancelamento e identidade do autor.

## Escopo confirmado com o agente de core

Somente finance_expense_items. Cancelamento irreversível por evento append-only; eventual payable aberto e exatamente correspondente é cancelado atomicamente. Não há reversão de vínculos, dinheiro ou pagamento. Qualquer histórico de alocação/pagamento/vínculo, descarga, associação legada histórica, reserva de manutenção/estoque, item de folha ou acerto protegido impede a operação. Desfazer um vínculo histórico não significa que esse gasto passa a ser elegível. Despesas avulsas permanecem fora desta identidade.

Comando informado pelo core: cancel_finance_expense com versão/tenant/request/expense_id/revision/reason; resultado expense_id/cancellation_id/payable_id/amount_cents/confirmed=true/cash_changed=false. A forma completa da consulta ainda precisa ser publicada pelo coordenador.

## Interface proposta

1. Em ExpenseHistoryDetail, ação `Revisar cancelamento do gasto`; não chamar de editar ou excluir. Novo componente `ExpenseCancellationReview`, com props tenant/actor/expenseId e callback de atualização. Abrir consulta própria, sem autorizar usando a cópia antiga da listagem.
2. Identificar gasto e lote por ID, categoria, fornecedor, data, valor original e comprovante preservado. Mostrar três efeitos separados: custo deixa os indicadores ativos; título indicado será cancelado quando o servidor declarar esse efeito; dinheiro/pagamentos não mudam.
3. Bloqueios permanentes e dependências devem mostrar tipo, ID e motivo. Usar os vínculos reais, nunca equivalência por valor/data. Se houver histórico bloqueante, não sugerir simplesmente desfazer vínculo nem registrar pagamento para contornar.
4. Exigir motivo e declaração de que o gasto está errado/duplicado e que o original permanecerá auditável. Revisão final deve repetir o valor e o título afetado. Rótulo final `Confirmar cancelamento do gasto`. Não criar automaticamente um gasto substituto.
5. Após sucesso, manter detalhe/linha original visíveis com `Cancelado — excluído dos custos ativos`, autor/ID, data/hora, motivo, cancellation_id e situação do título. Comprovante e relações históricas continuam acessíveis. Não oferecer botão de desfazer se o comando é irreversível.
6. Lista padrão inclui ativos e cancelados, distinguindo visualmente o cancelado com texto e cor. Filtro opcional `Todos / Ativos / Cancelados`. Totais financeiros/gráficos permanecem explicitamente de ativos; total de registros históricos e quantidade cancelada são contagens separadas. Não somar valores cancelados para obter um KPI atual nem ocultar a linha após a ação.

## Contratos mínimos necessários

Novo cliente/contrato próprios `expenseCancellationClient.ts` e `expenseCancellationContract.ts`, consulta sugerida `get_finance_expense_cancellation_context(tenant,expense_id)` (nome público a confirmar; core informou helper privado expense_cancellation_context).

Resposta precisa de envelope de identidade, revisão combinada, estado ativo/cancelado, capacidade do usuário, elegibilidade, bloqueios com IDs históricos, resumo original do gasto, efeito previsto no payable (ID/status/valor/ação), cash_changed=false, cancelamento existente e histórico autor/motivo/tempo. Totais monetários em strings de centavos. Não inferir ausência de pagamento a partir de status de título apenas.

Consulta da lista deve devolver status/cancellation e total_active_count/cancelled_count, deixando claro o universo dos agregados. RecordedCosts e resumo da Financial precisam consumir a exclusão do servidor. A UI não deve recalcular os KPIs subtraindo a linha localmente.

Estados do painel: consultando, consulta falhou, permitido para revisão, bloqueado com origens, revisão final, envio, pedido incerto recuperável, cancelado confirmado. Pedido durável por empresa/ator/gasto, preso à revisão original após resposta perdida; corrupção bloqueia novo envio; rejeição conhecida na primeira tentativa libera nova consulta/revisão. Dados obsoletos não autorizam ação.

## Integração e validação previstas

Incluir tenant/actor no detalhe ou abrir painel pelo workspace. Após comando, atualizar listagem e o detalhe por ID, além de finance-recorded-costs, finance-recorded-cost-summary, payables, finance-settlement-expense-context, driver_settlement(s), opções de custos/manutenção/estoque e auditoria pertinentes. Não alterar saldos/fechamentos localmente; evidências já preservadas de períodos ficam sob contrato do coordenador.

Testes: despesa sem obrigação, complemento aberto exato, bloqueio por cada família histórica, cancelamento já existente, pedido perdido/replay, mudança após revisão, conta/tenant/ator incorretos, original/comprovante/autoria visíveis após sucesso, exclusão dos KPIs ativos com paginação sem somar amostras. Manter o fluxo de lançamento em lote intacto.
