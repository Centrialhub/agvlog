# Comprovante preparado do lote — evidência SQL local

Candidato: supabase/migrations/20260911064852_finance_batch_prepared_receipt_intents.sql.
SHA256 inicial revisável: 3c43f6aaa74571d03f86fb9533989098bdf689c12f5a3ac453dc4537dde3f215.

Implementação local completa do ramo preparado: intenção privada append-only por empresa/ator/pedido/linha, fonte expense_draft, verificação do artefato sanitizado, ticket privado por transação e consumo no batch. Suporta trip, office, personnel, maintenance e other. Exige comprovante real para descarga e conserva caminho/justificativa nulos no ramo v2. Nenhuma coluna acrescentada a finance_expense_items. source_snapshot existente guarda a prova nova da descarga; registros antigos não são atualizados.

Guarda imediata substitui a possibilidade de INSERT sem recibo por exigência de ticket exato; constraints diferidas exigem consumo, objeto validado e comando do batch completo no commit. Ticket remanescente impede commit. O lote e record_unloading reautorizam após locks e antes de replay; consumo não usa o ticket de serviço como autorização financeira.

Integrações: assert_source/reserve de upload, record_expense_batch, record_unloading, expense_receipt_source/count/history, unloading_origin_base e unloading_projection_repair_context. O histórico retorna receipt_intent_id nullable e aceita fonte preparada somente com binding consumido para a despesa. Não altera can_access, finalizer sanitização, política de leitura do Storage ou funções de storage capturadas pelas baselines monetárias. Não há PDF liberado ou scanned=true fabricado.

Nove definições e ACLs foram consultadas por SELECT em produção e guardadas por MD5prosrc, securitydefiner, search_path e grants explícitos. Captura completa em finance-batch-prepared-receipt-predecessors-2026-09-11.json. Constraints originais também possuem precondições exatas (receipt CHECK e source_type CHECK). A fixture ancestral omitia o CHECKde recibo; o instalador independente restaurou o CHECKoriginal antes da candidata, sem remover preflight.

Em src/test/preparedExpenseBatchReceipt.test.ts, 3 testes passaram em 2026-09-11 04:03:17; eslint0:

- Office: intenção pública/schemaUI, reserve→prepare→finalize por SQL real, batch, replay, constraints ALLIMMEDIATE e count1. receipt_path/no_receipt_reason null verdadeiros.
- Trip descarga: entrega/documentos e lote reais com comprovante preparado; flushconstraint, origem verifiedtrue, correção positiva do custo eligibletrue e histórico vinculado à intenção.
- Negativas: artefato ainda em quarentena, UUID de outra linha, falha do segundo item depois de consumir o primeiro (sem despesa/link/consumo/ticket residual), recuperação do mesmo pedido, revogação impedindo replay.

O helper preparedReceiptImageCallback usa metadata/bytes do benchmark hosted já realizado e executa o protocolo SQL verdadeiro; esta rodada não é nova execução do codec Edge nem upload Storage hospedado. PGlite prova semântica/atomicidade local, não concorrência nativa. Revisão/testes independentes do banco ficam em arquivo próprio. Não houve apply/deploy/commit nesta tarefa.

Produção, conforme captura do root, tinha expense_count0/charge_count0/amendment_count0; portanto não se afirma preservação de registros inexistentes em produção. A prova com origem150→custo120 anterior pertence à fixture integrada independente. Root registrou expense_columnsMD5 506369c80621675a939ac2bd005c482e para comparação de schema no rollout. Aplicação/publicação aguardam revisão e ensaios integrados.
