# Correção de recebimentos com ledger delegado — 2026-09-10

Candidato local supabase/rollouts/finance_receipt_allocation_corrections_invoice_lifecycle.sql SHA256 fbb305cdef1341198697b1ba529e59382fc57bf7a07939aefcfff99334b23132. Original20260910025658 intacto. Sem escrita remota ou PG nativo por este agente.

Problema reproduzível por inspeção:192908 delega cálculo para _receivable_ledger_evidence;025658 exige SUM/filter inline no snapshot e abortaria. Compat aplica exclusão das correções ao filtro do ledger, preservando exclusão dos créditos011121. Snapshot recebe somente metadata allocation_correction no histórico; crédito e política fiscal permanecem. Demais definições025658 são preservadas.

Guard exige prosrc exato pós011121compat+12152: ledger dc491a846bca5fd6392bf9386cdf5b0b; snapshot857a4635e4b7dc465b4c52b165227931, SECURITY INVOKER e ausência de execute authenticated/anon/service_role. Exige exatamente uma ocorrência do filtro antes do patch. Fonte desconhecida falha; não remove proteção para encaixar.

Teste src/test/financeReceiptCorrectionInvoiceLifecycleCompatibility.test.ts: três casos PGlite passaram,6,29s/exit0. Usa createReceivableFinancialDatabase(true,false), foundation real, fixture compartilhada financeFiscalInvoiceLifecycleFixture com ledger/snapshot192908 reais,011121compat e12152, depois24438 e candidato025658.

1. Recebimento real, correção pública, replay, snapshot net0 semrequires_reconciliation, história auditada, reuso da mesma entrada net1000 sem novo finance_movement.
2. Ledger ausente/renomeado: candidato rejeita e rollback remove tabela de correções criada no começo da transação.
3. Emissão CTe autorizada→worker→receber→cancelar→worker: crédito fiscal preservado, snapshot net/open0, historycredit_id e correctionnull, tentativa de corrigir a mesma baixa rejeitada,1movement e0corrections.

Limites: fixture herda schema operacional de testes e instala apenas funções delegadas192908 relevantes, não toda stackSupabase/Storage/Auth nem todos writers remotos. Não há teste nativo nesta rodada nem alegação de liberação integral. A prova positiva usa comandos e workers reais, sem stub de sucesso ou desativação de guard.
