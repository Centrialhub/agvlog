# Provas monetárias com movimento invalidado185338 — UI — 10/09/2026

Contrato confirmado diretamente com autor do core: integrity.context.movement_voids contém eventos completos; corte.manifest.evidence.finance_movement_voids contém eventos e blockers legacy_source_movement_voided; carteira pública contém issues/payment_ids, sem movement_ids. Helpers paid_projection_chain/legacy_cut_settlement_evidence/185517 permanecem privados, não foram consultados pela UI.

paidMovementVoidLabels traduz paid_projection_movement_voided, payment_movement_voided, source_movement_voided, legacy_source_movement_voided e settlement_movement_voided. Integrado às tabelas de rótulos da carteira, integridade e corte. A comprovação inconsistente não apaga pagamentos, não reabre títulos e não gera nova baixa.

PaidMovementVoidEvidence apresenta evento, movimento, autor/ID, data e motivo, com paginação30. Valida forma mínima e tenant; evento malformado/de outra empresa resulta em aviso de informação incompleta. Usado somente nos campos públicos reais do corte/integridade. Nenhum valor monetário é somado nesse componente.

LegacyCutReview mantém footprints disponíveis mesmo fora da classificação exact_projection_alias, explicitamente como parcelas com comprovação inconsistente. Conta/data/vínculo ausentes e ausência de IDs dos movimentos ficam evidenciados. Valores preservados não representam nova saída. Carteira mantém payment_ids/originIDs e mensagem legível; expor movement_ids nessa carteira requer ampliação pública futura pelo backend, sem bloquear esta entrega.

Validação:18testes em5arquivos passaram (evidência3, integridade3, corte6, carteira4, contrato projeção2); lint9arquivos aprovado. Sem SQL ou TSC nesta entrega. Exportações/snapshots originais não foram modificados.

Arquivos novos: paidMovementVoidLabels.ts, PaidMovementVoidEvidence.tsx, paidMovementVoidEvidence.test.tsx. Integrações: legacyIntegrityContract.ts, legacyCutReviewContract.ts, payablePortfolioLabels.ts, LegacyUnresolvedInventory.tsx, LegacyCutReview.tsx e legacyCutReviewPanel.test.tsx.

TSC integrado único60350 concluiu exit0; log finance-paid-movement-void-diagnostics-ui-tsc.log vazio. Nenhum TSC ativo. Coordenador confirmou15testes integrados de provas8+origem7 após contratos finais185338/185517.
