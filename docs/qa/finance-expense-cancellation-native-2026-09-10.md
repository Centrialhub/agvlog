# Cancelamento de despesa não paga — PostgreSQL nativo

2026-09-10. **7 testes passaram em PostgreSQL17.11**, handle31310exit0, servidor parado. Nenhuma alteração remota/core.

Hashes75641:20fa89e70daa64f04ea1c8c4590801e9e0a63ea9e8e5e4f4ae7879f9d65b5984;75733:f552240ad6b9b59c069c519729e75868180d51e764f4bb0b0d92026ed4ebafd0. Confirmados no log.

Script scripts/test-finance-expense-cancellation-native-cases.mjs; selectorfinance-expense-cancellation. Log node_modules/.cache/qa-postgres/finance-expense-cancellation-native-2026-09-10.log.

- Lote real32itens: cancelamento/replay do primeiro, título cancelled, histórico32/ativo31, valor histórico3200 e ativo3100; segunda página2. SchemasUI reais preview/history/result.
- Replay concorrente produz uma cancellation.
- Pagamento real vence corrida: cancelamento rejeita, pagamento/movimento preservados.
- Cancelamento vence corrida: pagamento não revive obrigação cancelada, nenhum payment novo.
- Revogação durante espera observada por pg_blocking_pids rejeita sem cancellation.
- Viagem com favorecido motorista e fornecedor distinto usa obrigação original correta e cancela.
- Associação real de aquisição de estoque vence corrida: cancelamento rejeita e mantém custo vinculado.

Fixture deriva grafo restrito real de manutenção/estoque/folha/lotes/payables, com foundation de fechamento e resolvedor de fonte real. Não ensaia fechamento positivo aqui. Registros de estoque/viagem são semeados; comandos de lote, pagamento, associação e cancelamento são reais. Contra pagamento testou ambas ordens; contra estoque apenas associação vencedora. Não cobre todas as associaçõeslegadas nem concessão de acesso após espera, nem integração remota. A visão ativa de pagamentos da fixture anterior é suficiente para casos sem estorno aqui; não usar como prova de todos os estornos. Não foram alterados SQLs para fazer testes passar.
