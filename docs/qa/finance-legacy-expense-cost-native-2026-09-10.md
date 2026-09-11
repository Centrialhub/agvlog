# Associação de custos legados — ensaio nativo 2026-09-10

Suite: `scripts/test-finance-legacy-expense-cost-native-cases.mjs`; selector `finance-legacy-expense-cost` no runner central. Log: `node_modules/.cache/qa-postgres/finance-legacy-expense-cost-native-2026-09-10.log`.

## Escopo e limites

Fixture reproduz `createLegacyExpenseCostDatabase`: tabelas baseline, builder real, lifecycle/guards de folha, batch real, vínculo e readers reais. A rota física fica vazia, km retorna null e o leitor operacional retorna zero documentos explicitamente; não é prova de cálculo de rota/receita nem de validação da entrega. FKs do grafo operacional completo não são instaladas. Active payable payments é uma view estreita; esta suite não valida estornos/adoção de pagamentos históricos.

Obrigações canônicas são criadas pelo comando real do lote. Snapshots comparam payables, payments, movimentos e alocações entre associação/reversão/rebuild. Os primeiros 12 cenários usavam custo não pago. A extensão final abaixo adiciona movimentos, alocações e pagamentos preenchidos por comandos reais e compara esses registros integralmente.

Preparação de folha insere período draft, entrada approved e depois promove período para approved sob identidade financeira. Nenhum trigger é desativado; não substitui teste do comando normal de aprovação de folha.

Origem permanece imutável depois de desfazer o vínculo, por decisão do contrato atual. Correção auditada da própria origem é uma etapa futura; reversão não abre permissão de editar o passado.

## Casos

1. Replay simultâneo: um vínculo e resposta compatível com schema real, sem mudar obrigações.
2. Dois pedidos para a mesma origem/alvo: apenas um ativo.
3. Uma origem disputando dois custos: apenas um ativo na origem.
4. Duas origens disputando o mesmo custo: apenas um ativo no destino.
5. Edição legítima da origem antes de liberar lock: revisão antiga rejeitada, sem comando residual.
6. Autor revogado enquanto espera a trava financeira: acesso rejeitado após espera.
7. Reversão concorrendo com reassociação baseada em revisão antiga: rejeição; nova revisão permite reassociar e mantém autores/histórico.
8. UPDATE/DELETE da origem após reversão continuam proibidos.
9. Builder real: custo duplicado 100 → associação + recálculo 50 → recálculo repetido sem acúmulo → reversão + recálculo 100; nenhum novo título.
10. Acertos approved/paid/closed preservam snapshots e impedem associação; reversão também é impedida após proteção.
11. Folha aprovada impede associação, mantendo títulos.
12. Inventário e contexto passam pelos schemas reais; perfil motorista e tenant estrangeiro rejeitados.

## Hashes

- 155442: `74ba3d2af100d5c41643705037c9535836cda26cc88646a1360a06b13e718e19`
- 155523: `f7e120e53e4639d9092de78f5c499827e46fac0cd52cea4ad9af50219a86ee63`

Tentativas anteriores foram encerradas com PG parado: 49250 passou oito casos e falhou na representação textual numeric do builder; assert corrigido para centavos inteiros. 3645 passou dez casos e falhou na preparação da folha sem claim de ator na conexão; seed corrigido para identidade explícita. Nenhuma migration de produto foi alterada.

## Resultado final

A rodada anterior 20240 passou 12 testes. A execução final **44642 passou 14 testes**, exit 0, PostgreSQL 17.11 descartável encerrado. Hashes55442/55523 permaneceram iguais. Sem acesso remoto nem alteração de SQL do produto.


## Extensão: dinheiro e pagamentos preenchidos

13. Saída de **5.000 centavos** registrada por record_finance_movement e vinculada ao item pelo record_finance_expense_batch real. Antes/depois da associação e da reversão, comparação integral de movimentos/alocações/payables/payments: nenhuma mudança; a alocação e a saída continuam presentes.
14. Custo canônico sem alocação gera título. Após aprovação do status no seed, record_finance_movement registra saída de 5.000 centavos e apply_finance_payable_movement registra pagamento real e vínculo. Trigger _recalc_payable_paid real deixa título paid. Associação e reversão do custo preservam byte a byte título pago, pagamento de 5.000 centavos, movimento, vínculo de pagamento e todas as alocações. Pagamento continua único.

Dependências adicionais instaladas integralmente: 20260909220020_finance_expense_workspace_queries (SHA256 2c3b7904bb41a6ebf110225559ef794b4e17c4f79bbad68ce74d0049ad92eda2), 20260910002244_finance_payable_movement_links (SHA256 950528541ed07a28b12a83ff47212fe6534b02c6a5ac5f5a048d35e9d3006a43), função baseline _recalc_payable_paid e trigger real de recálculo. Nenhum pagamento foi inserido diretamente.

Esta extensão resolve a limitação de registros monetários vazios. Ainda não testa estorno do próprio pagamento, integração de extrato/bank_transaction ou conciliação bancária. A aprovação inicial do status do título é preparação privilegiada do seed; o registro do pagamento é o comando real.
