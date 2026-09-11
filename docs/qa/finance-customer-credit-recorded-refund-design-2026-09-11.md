# Devolução de crédito por saída já registrada

Proposta de contrato para bloco posterior à aplicação01312; nenhuma implantação ou promessa de transferência bancária. Migração candidata04822 criada via CLI. Não alterar01312/02519/03921 nem snapshots históricos.

## Semântica

Aplicação reduz crédito disponível e liquida título. Liberação compensa aplicação e reabre título; não é devolução. Devolução real consome crédito disponível e capacidade de uma saída financeira canônica existente. Não cria finance_movements, bank_transactions nem receivables_payments.

Journal privado customer_credit_refunds: id,tenant_id,credit_id,payer_id,outgoing_movement_id,amount_cents,request_id,actor_id/actor_name,reason,source_snapshot,payload_hash,result,created_at. Imutável e sem grants. Snapshot captura prova original do crédito, contraparte documental, movimento canônico e revisão. Evento central customer_credit_refunded representa vinculação auditada, não execução de transferência.

Overlay de customer_credit_position preserva original/applied/released; acrescenta returned_cents. available=original-applied-returned. Liberação de aplicação aumenta disponibilidade apenas pelo valor antes aplicado. Revisão inclui journal de devoluções. Prova inválida mantém available null. Campo returned não deve ser inferido de release.

movement_used_cents inclui montante das devoluções para competir com allocations/payable/settlement. Confirmar antes implementação todas as rotas de saída, transferências, abertura, void e retificação: presença no agregador sozinha não prova serialização nem proteção de movimento vinculado.

## Identidade

Movimento deve ser ativo, canônico, de saída, sem driver, de natureza compatível; não usar transferência interna. Documento normalizado beneficiary_document deve coincidir com tax_id do payer real do crédito (11/14 dígitos), sem ambiguidade no tenant. Nome não é prova de identidade. Documento ausente ou divergente produz indisponibilidade explícita; não inventar documento nem destinatário. Documento original fiscal, quando existente na prova, deve ser coerente.

## APIs privadas propostas

customer_credit_refund_context(tenant,credit,movement,amount_text): identidade+credit position+outgoing available+blockers+eligible+can_executefalse+revision. Todos os centavos em strings.

record_customer_credit_refund(payload version1,tenant_id,request_id,credit_id,outgoing_movement_id,amount_cents,expected_revision,reason): resultado com refund_id,amount_cents,cash_movement_created=false. Replay mesmo ator/payload; revogado não recupera resultado. Locks fiscal→finance compartilhados com apply/release; row-first failfast e reautorização após waits. Nenhuma emissão fiscal.

## Ensaios exigidos

Parcial/integral/excesso, pagador e tenant divergentes, documento ausente, replay, rollback sem evento, original crédito/pagamento/banco byte-identicos. Saída parcialmente usada tem capacidade global respeitada. Application↔refund e refund↔allocation/payment nas duas ordens, void de saída vinculada negado, source drift indisponível. Testes locais primeiro; native após congelamento e coordenação.
