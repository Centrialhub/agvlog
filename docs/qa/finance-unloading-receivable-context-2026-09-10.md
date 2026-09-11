# Diagnóstico antecipado da origem de descarga — 2026-09-10

Migração `20260910210433_finance_unloading_receivable_context.sql`. Acrescenta ao snapshot existente `source_issue` e `source_revision`, sempre nullable. Sem descarga ambos são null; com descarga o hash cobre cobrança preservada e identidade/valor/vínculos/status atuais do título. Esses campos participam da revisão final usada pelos comandos existentes.

Divergência usa `finance_unloading_source_mismatch` e força somente `can_receive=false`. Não altera `requires_reconciliation`, `reconciliation_reason` ou `can_reverse`: reconciliação do livro financeiro não é reparação da origem. O helper é privado, sem EXECUTE público; não cria RPC nem grants de tabelas. O wrapper e a autorização atuais permanecem.

Três testes PGlite reais passaram e ESLint passou: título comum e descarga íntegra continuam recebíveis; alteração de devedor permitida antes do guard gera diagnóstico e nova revisão; recebimento real antigo com devedor divergente mantém devolução real disponível depois de instalar205941 e210433. A fixture cria o histórico antes dos guards, sem desligar triggers.

Não é implementação de correção auditada da origem. Preview de divergência não conserta o título nem reatribui recebimento passado. PostgreSQL nativo e TSC não foram executados nesta frente;205941 permanece congelada e inalterada.
