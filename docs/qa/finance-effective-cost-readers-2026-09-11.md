# Leitores do custo efetivo — integração60700

Migration criada pela CLI, sem aplicação remota. Depende de60519 (resolver/journal/guards do autor),53349/54915 e leitores anteriores completos. Seis corpos predecessores têm guard MD5 normalizado CRLF, ACL, volatility e search_path conferidos contra SELECT de produção feito pelo coordenador. Nenhuma função capturada em190516 é substituída. Os testes comparam byte a byte payable_portfolio_evidence e check_payable_payment_insert antes/depois.

## Comportamento

Recorded_costs/summary usam um valor efetivo por despesa; fonte ativa inválida deixa total indeterminado. List_expenses mantém amount_cents original e acrescenta cost_origin/effective_amount_cents string|null, cost_needs_review_count e agregados correntes efetivos. historical_total_cents/cancelled_total_cents permanecem somas dos registros ORIGINAIS; alocação permanece dinheiro real. Não é relatório as_of nem ajuste lançado na data da correção.

canonical_trip_costs preserva deduplicação de associação legada55442 e exclusão de canceladas175641; valor efetivo na mesma origem, metadata expense_cost_version/original_amount_cents, sem reimbursement ou crédito adicional. Versão inválida aborta builder55000, não some via SUM ignorandoNULL. settlement_expense_context oferece cost_origin e valores efetivos; agregados tornam-seNULL se uma fonte é inválida.

Carteira mantém payable_portfolio_evidence intacto, acrescenta prova atual e versões de pagamento ao envelope/revisão. Origem canônica órfã produz pendência e total inválido, sem quebrar a consulta. BEFORE INSERT finance_events captura expense_cost_version somente no evento payable_movement_applied, dentro da transação do pagamento existente. Não altera resposta do writer nem reinterpreta pagamentos antigos sem marcador. O evento original e o snapshot de versão permanecem imutáveis.

## Ensaios

7 testes PGlite passaram, ESLint0. Correção real150→120 aparece uma vez no histórico/summary/recorded/canonical; recibível150 e custo original150 preservados. Pagamento real120 após aprovação congela versão no evento e carteira. Builder baseline real com extensão canonical reconstrói uma única linha120 e um único payable, sem dinheiro ou crédito adicional.32custos em comandos reais provam total15100 apesar de custo retificado fora página1 e filtro por categoria. Fonte canônica órfã deixa carteira inválida. Journal inconsistente sem comando/evento, inserido somente como owner na fixture adversarial, não volta ao custo original nem a soma parcial. Motorista misto negado. Parsers de produção expenseHistory, expenseCostOrigin, recordedCosts, recordedCostSummary, settlementExpenseContext e payablePortfolio exercitados.

Fixture parte do banco/recebíveis/reparo/cancelamento reais e acrescenta leitores de produção, patchmanual81257 e dedup55442 reais. Quarentena usa DDL/DTO/count reais, sem simular validação de arquivo; não há bytesStorage remotos. Pais operacionais ausentes/FKs removidas no helper base continuam limite declarado. Builder usa baseline+extensão canonical, não substitui ensaio integral do lifecycle atual/folha. Nenhum PG nativo, concorrência real, build global ou deploy por este agente. Core60519 ainda em revisão do autor; hashes finais e rodada integrada competem ao coordenador.

Correções de fixture necessárias: 55442 faltava na canonical_trip_costs inicialmente; agora o guard exige corpo de produção. O payment capacity guard02244/03529 também foi instalado realmente para pagamento posterior. Nenhum guard foi afrouxado para passar. O helper usa split/join compatível com targetTS após revisão global do root.
