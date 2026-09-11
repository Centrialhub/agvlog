# Reversões de vínculo de acerto — PostgreSQL nativo

Execução local descartável em PostgreSQL **17.11**, somente loopback. Suite `PG_QA_SUITE=finance-settlements`, via `scripts/test-delivery-concurrency.mjs`. Nenhuma conexão ou alteração remota.

**14 testes passaram:** oito casos existentes de vinculação/capacidade mais seis casos de reversão:

1. Duas sessões repetindo o mesmo pedido de reversão produzem uma reversão, um comando e um evento; resultado idêntico em replay.
2. Dois pedidos diferentes não revertem duas vezes o mesmo vínculo.
3. Novo vínculo aguardando a reversão usa a capacidade liberada; ficam dois vínculos históricos e somente um ativo. Consulta devolve histórico com autoria/reversão e identifica o vínculo ativo correto.
4. Dois novos vínculos concorrentes depois da reversão não deixam dois ativos.
5. Baixa de título aguardando a reversão ocupa a capacidade liberada; tentativa posterior de revincular o acerto é rejeitada por excesso de alocação.
6. Revogação da associação do operador enquanto a reversão aguarda o bloqueio impede reversão, comando e evento; vínculo/capacidade originais permanecem ativos.

Cada disputa usa duas sessões reais e só libera a primeira depois de observar a segunda em `pg_blocking_pids`. Os casos novos comparam o conteúdo completo do movimento e pagamento histórico antes/depois, além das contagens globais de movimentos/pagamentos e conteúdo de transações bancárias. Corrigir associação não altera o dinheiro nem o pagamento de acerto.

## Candidatos instalados

| Migration | SHA256 |
|---|---|
| 20260910130540_finance_settlement_movement_links.sql | a05183495df24000b81fd2976a6723df0c4700dbdf2d82b5dca679e47e1f1205 |
| 20260910130921_finance_settlement_movement_options.sql | 3f1a107e4f02187638bf145d03842f860b8e13c16d11ba5515a615e989953821 |
| 20260910131149_finance_settlement_link_audit.sql | 5101428db9da57754866db67ed54bc9c649116adce21280045fb51e33fa2289f |
| 20260910132411_finance_settlement_link_reversals.sql | 34cd9f338917b7c461acd7b81e104019312e7834c3c770a4c388f4cdc6dcdf52 |

Além destes, o runner instala as migrations reais do núcleo de movimentos, despesas, capacidade compartilhada, folha/títulos e auditoria contra dependências sintéticas. Não corresponde a ensaio completo do esquema de produção.

Arquivo ampliado: `scripts/test-finance-settlements-native-cases.mjs`. `node --check` passou. Log integral: `node_modules/.cache/qa-postgres/finance-settlement-reversals-native-2026-09-10.log`.

A primeira tentativa terminou antes dos testes porque o sandbox impediu `pg_ctl` de criar token restrito (erro 87). Após confirmar saída terminal, execução com escalonamento autorizado iniciou o servidor descartável e concluiu com código 0. O runner confirmou parada do PostgreSQL e ausência de `postmaster.pid`.

Esta validação cobre as disputas descritas. Não demonstra browser, implantação, migração histórica, autorização de todas as rotas, processamento integral de folha ou encerramento do módulo financeiro.
