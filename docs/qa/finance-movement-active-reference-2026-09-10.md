# Referência bancária de movimentos ativos — 10/09/2026

Migration CLI `20260910184213_finance_movement_active_reference.sql`, SHA256 `8fbcdb2344bb125fa68f61647ce36c91db95f71e55eba09a4c7e24a746aebf3c`.

O patch substitui somente o SELECT de duplicidade de `bank_reference` em `finance_private.record_movement` pela view privada `active_movements`. INSERT, evento, resultado e consulta de replay permanecem brutos/imutáveis. O patch exige os trechos exatos de consulta e trava financeira, falhando se o contrato mudar.

A definição anterior verificava acesso antes da espera pelo advisory, sem nova conferência posterior. Foi acrescentado `can_access(t)` imediatamente após obter a trava, antes de retornar replay ou escrever. Não há alteração de payload, grants, guarda de conta, validação de driver, proibição do fluxo avulso de transferência ou triggers de período fechado.

## Prova executada

`src/test/financeMovementActiveReference.test.ts`: **4 testes PGlite passaram**; ESLint zero erros. Factory real `createAccountPeriodCloseDatabase(true)`, com dependências de transferência/fechamento/corte já existentes, mais182541/182830/184213. Sem TSC próprio, conforme coordenação.

- Duas saídas ativas de mesma conta/referência continuam rejeitadas.
- Após void explicitamente inserido pelo owner da fixture, um novo `record_finance_movement` real aceita a referência; uma terceira tentativa é recusada.
- Replay original retorna exatamente o ID original, sem ressuscitar o registro nem criar dinheiro. Dois registros brutos permanecem; a view ativa tem um registro de5000centavos.
- Histórico bruto intacto e UPDATE rejeitado; payload de replay alterado rejeitado; conta estrangeira e autor revogado rejeitados.
- Período histórico fechado bloqueia a nova saída mesmo após invalidação do registro anterior; replay do pedido antigo permanece sem mutação.
- Verificação estrutural comprova autorização posicionada depois da trava. Não houve ensaio de duas sessões/revogação durante espera nesta rodada.

## Limites

A anulação é owner-only fixture, não comando público de correção. O fechamento do teste é fixture histórica com ticket interno, usada para exercitar a guarda real, não prova positiva de elegibilidade/fechamento. PostgreSQL nativo permanece parado. Nenhuma alteração remota. Esta migration não adapta checagens de referência de comandos de transferência ou outros writers.
