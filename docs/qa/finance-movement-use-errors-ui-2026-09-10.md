# Mensagens e recuperação dos guards de movimentos83506 — 10/09/2026

Helper movementUseErrors.ts traduz finance_movement_use_busy, finance_movement_voided, finance_movement_reference_invalid e finance_movement_capacity_inconsistent. Integração em financeError (lotes), financialError (recebíveis), settlementPaymentError, PayableMovementLink, SettlementMovementLink e LegacyPayable/ReceivableAssociation. Mensagens não dizem que invalidar movimento desfaz pagamento e não inventam ajuste de dinheiro.

settlementPaymentClient e settlementMovementClient passam a reconhecer SQLSTATE40001 como rejeição transacional conhecida. Os demais caminhos já reconheciam23514/40001. Primeira tentativa rejeitada permite revisar; pedido previamente incerto continua preservado integralmente. ReceivableFinancialOutbox mantém sua regra anterior. Vínculo pagável mantém fallback de rejeição conhecida sem apresentar apenas resposta incerta. Acerto mostra aviso legível também em falhas de consulta e tentativas preservadas.

Testes:61 passaram em11arquivos, cobrindo helper nos4códigos,40001 em ambos clientes de acerto, primeira rejeição versus retryincerto, outbox de recebíveis e associações legadas. Lint14arquivos aprovado. Rerun final de3testes pagáveis passou após refino do fallback. Sem TSC nesta fase por coordenação com core; nenhuma migration alterada.

Novos: src/lib/financial/movementUseErrors.ts; src/test/movementUseErrors.test.ts. Alterados: ledgerContract.ts, receivableCommands.ts, settlementPaymentClient.ts, settlementMovementClient.ts; PayableMovementLink.tsx, SettlementMovementLink.tsx, LegacyPayableAssociation.tsx, LegacyReceivableAssociation.tsx; settlementPaymentClient.test.ts, settlementMovementClient.test.ts, settlementPaymentWorkspace.test.tsx, settlementMovementWorkspace.test.tsx. Asserções antigas que exigiam código bruto foram substituídas por mensagens legíveis, preservando verificações de armazenamento e capacidade obsoleta.

TSC integrado único83959 concluiu exit0; log finance-movement-reconciliation-errors-ui-tsc.log vazio. Nenhum TSC ativo.
