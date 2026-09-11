# Invalidações nas evidências preservadas de fechamento — UI — 10/09/2026

`buildAccountPeriodEvidenceIndex` reconhece facts.movement_voids e facts.voided_movements. Ambos ausentes continuam compatíveis com fechamentos históricos; quando um aparece sem o outro, ou evento/original está incompleto, o índice registra pendência em vez de presumir histórico limpo. Originais repetidos ou presentes também na lista ativa geram diagnóstico.

Eventos tornam-se manual_decisions kind=movement_void com autor, motivo, data e IDs de movimento/duplicidade/substituição. Comprovantes de originais invalidados usam kind=voided_movement_receipt e rótulo explícito de exclusão dos valores ativos. Não entram em qualquer soma monetária, não substituem facts.movements e não reescrevem snapshot/export. O índice permanece exclusivamente derivado do registro preservado, sem consultar fonte atual.

AccountPeriodEvidenceIndexPanel apresenta invalidação separadamente de conciliação/reversão. AccountPeriodEvidencePanel traduz dependency source_kind finance_movement_voids para Invalidação auditada de movimento. Valores ativos continuam vindo dos saldos e facts.movements preservados pelo servidor; nenhum cálculo com originais invalidados foi introduzido.

Validação: 8 testes passaram (3 novos accountPeriodMovementVoidsIndex, 5 existentes accountPeriodEvidenceIndex), incluindo autoria/referências, comprovante original, export imutável, saldo inalterado e compatibilidade histórica/diagnóstico parcial. ESLint dos4arquivos aprovado. Sem TSC conforme coordenação; nenhuma migration, schema/lista de ledger ou RPC de correção alterado.

Arquivos: src/lib/financial/accountPeriodEvidenceIndex.ts; src/components/financial/AccountPeriodEvidenceIndexPanel.tsx; src/components/financial/AccountPeriodEvidencePanel.tsx; src/test/accountPeriodMovementVoidsIndex.test.tsx.

Refino: comprovante de original invalidado sem receipt_evidence gera aviso específico de metadados incompletos. Não é incluído na lista de comprovantes ausentes de movimentos ativos. Novo teste dedicado passou; total9testes de índice e lint aprovados.

TSC integrado89170 terminou exit0; log finance-period-movement-void-evidence-ui-tsc.log vazio. Nenhum TSC ativo. Sem nova execução prevista enquanto guards83506 evoluem.
