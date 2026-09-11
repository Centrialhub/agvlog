# Movimentos ativos — PostgreSQL nativo — 10/09/2026

**5 testes passaram**, PostgreSQL17.11 local descartável, handle39400 terminado com exit0; servidor parado. Log: `node_modules/.cache/qa-postgres/finance-active-movements-native-2026-09-10.log`. Script: `scripts/test-finance-active-movements-native-cases.mjs`, selector `PG_QA_SUITE=finance-active-movements`.

## Hashes instalados

-182541foundation: `1085d55520ecf05a34ca2c5a64e22e2830b64cdb906b2ef5aa37a07d8d09d74a`
-183506guards: `130bc344d89633f918fefb977dd4d7d2a3a1769e3eaa4bf0bd6ff0079480dfaf`
-184213reference: `8fbcdb2344bb125fa68f61647ce36c91db95f71e55eba09a4c7e24a746aebf3c`

## Provas reais

1. `record_finance_movement` rejeita referência ativa duplicada; após anulação inserida pelo owner, novo comando real aceita a mesma referência. Replay do primeiro retorna o mesmo ID sem ressuscitar dinheiro. Dois registros brutos, um ativo; UPDATE do original rejeitado.
2. Dois comandos com requests diferentes disputam a mesma referência sob trava real: apenas um persiste, o outro retorna `finance_reference_already_recorded`.
3. Comando de replay bloqueado aguardando trava, com autorização revogada pelo titular da trava: após espera retorna `finance_access_denied`, sem novo movimento.
4. `record_finance_expense_batch` real produz custo e alocação1000centavos. SessãoA segura a linha da alocação; sessãoB obtém trava financeira e espera essa linha. Após `pg_blocking_pids` confirmar a espera, sessãoA tenta UPDATE. Trigger retorna exatamente SQLSTATE40001/`finance_movement_use_busy`; subtransação é revertida, A libera a linha e B termina. Não aceitamos40P01 como sucesso. Alocação permanece1000.
5. Após invalidação owner do movimento com alocação histórica, novo INSERT residual é recusado com `finance_movement_voided`; disponibilidade é0 e alocação histórica continua1000.

## Grafo e limites

A fixture parte do grafo real usado no nativo de adoção de pagáveis, adiciona tabelas reais de correções/recebimentos e a definição real de capacidade de entrada45616, conforme `createActiveMovementFinancialDatabase('outgoing')`. O antigo helper permissivo de administrador foi substituído pela definição baseline real. Comandos de movimento, lote e guardas/capacidades são instalados das migrations. FKs não relacionados de algumas tabelas de recebimento são omitidos como na factory de domínio. Não é ensaio completo de todas as migrations de produção.

Esta rodada cobre o domínio de saída e concorrência de alocação. Não executa fluxo de recebimento, pagamentos diferidos ou conciliação183442 em PostgreSQL nativo; esses mantêm suas provas PGlite separadas. Não prova concorrência contra um comando público de anulação: **não existe voidRPC nesta etapa**, e a anulação é owner-only fixture. A inserção deliberada de void sobre histórico alocado serve apenas para provar leitura/rejeição residual, não autoriza o futuro comando a ignorar dependências.

Nenhuma alteração SQL de produto foi necessária. Nenhuma conexão ou alteração remota. Servidor encerrado pelo finally do runner.
