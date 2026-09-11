# Rejeições de conciliação83442 — UI — 10/09/2026

Leitura confirmou ledgerClient.rpc já classifica23514 e40001 como FinanceRejectedError quando mensagem finance_. StatementReconciliation/ReconciliationReversal já liberam somente a primeira tentativa rejeitada; pedidos previamente incertos permanecem preservados.

Faltavam explicações específicas: reconciliationGuardError agora traduz finance_reconciliation_movement_inactive (registro invalidado, revisar movimentos ativos, histórico permanece) e finance_dependency_busy (dependência concorrente, atualizar/revisar). reconciliationError usa o helper na conferência/confirmação, ReconciliationReversal usa na rejeição conhecida. Significado do erro compartilhado nos cancelamentos não foi alterado.

11testes passaram:2cliente/classificação SQLSTATE+mensagem,4fluxo conciliação e5histórico/reversão. Novo caso cobre primeira rejeição por movimento inativo, seguida de resposta perdida e retry com concorrência conhecida que preserva o mesmo pedido. ESLint dos4arquivos aprovado. Nenhum SQL/TSC executado, aguardando coordenação.

Arquivos: src/lib/financial/reconciliationContract.ts; src/components/financial/ReconciliationReversal.tsx; src/test/reconciliationGuardErrors.test.ts; src/test/statementReconciliation.test.tsx.

TSC integrado único83959 concluiu exit0; log finance-movement-reconciliation-errors-ui-tsc.log vazio. Nenhum TSC ativo. Verificação inclui integrações de mensagens83506 e conciliação83442.
