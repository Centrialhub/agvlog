# Provas monetárias diante de correção do movimento

Migração local: 20260910185338_finance_void_aware_monetary_proofs.sql.
SHA-256: de962a9c2d7ab108974c75fe5f9ec6430129b60d7725be75e9c1b4e17b0b8c0a.

## Decisão e consumidores efetivos

Os cinco consumidores continuam lendo os fatos históricos brutos. Excluir o movimento da consulta apagaria a explicação do pagamento ou permitiria tratar a obrigação como aberta. O evento de correção torna a prova inválida, preservando fonte, valores e IDs. Não há comando público de correção nesta migração.

| Consumidor | Alteração |
|---|---|
| legacy_integrity_rows | Acrescenta context.movement_voids e source_movement_voided às fontes vinculadas por IDs exatos, inclusive aliases de pagamento e folha. |
| paid_projection_chain | Inclui eventos no snapshot/revision e invalida prova com paid_projection_movement_voided; cadeia pai inválida continua diagnosticada. Pagamentos e footprints existentes permanecem. |
| legacy_cut_settlement_evidence | Movimento void impede valid; mantém conta e movement_ids conhecidos, evento e revisão explícita. Os chamadores devem verificar valid. |
| payable_portfolio_evidence | payment_movement_voided invalida centavos agregáveis, sem zerar payment_ids, cancelar pagamento ou reabrir título. |
| legacy_cut_manifest | Inclui finance_movement_voids na evidência determinística; revisão anterior perde current. Fontes pagas vinculadas ficam bloqueadas. Um movimento manual livre corrigido apenas muda a revisão, permitindo nova conferência explícita. Versão do classificador: 4. |

source_movement_void_evidence resolve referências por IDs: pagamento de pagável/acerto/recebível, bank_transaction_id, adiantamento→título→pagamentos, folha→origem e aliases operacionais de recebimento. Usa limite de profundidade 8 e mantém todos os vínculos históricos; não infere identidade por valor/data. Função privada sem grants de aplicação.

## Validação

8 testes PGlite passaram em financeVoidAwareMonetaryProofs.test.ts, além de ESLint dos dois arquivos TypeScript. Cobertura: instalação das cinco definições efetivas; pagamento real de adiantamento via apply_finance_payable_movement; preservação de footprints/valor/IDs; carteira sem totais falsos; evento em fonte de integridade; acerto preservado com prova inválida; folha already_paid sem data propagando invalidez; revisão real aprovada→stale→nova aprovação para movimento livre; parse do RPC público pelo legacyCutReviewSchema. Export das seis definições finais e seus hashes no JSON effective adjacente.

A factory própria reutiliza a cadeia de fechamento/caixa e instala a carteira e foundation de correção reais. Instala também a função baseline _recalc_payable_paid, com a substituição efetiva para active_payable_payments, e seu trigger real: a fixture herdada não continha esse trigger. Não há novo stub de escritor bem-sucedido.

## Limites explícitos

A fixture não é o schema integral de produção: o pagamento real herdado é a versão 002244; a fonte e vínculo de acerto são semeados como história existente. Eventos void são inseridos diretamente somente na fixture para reproduzir um estado histórico inconsistente, pois nenhum comando de correção foi liberado. Não se afirma que corrigir um movimento com dependências seja permitido. Não houve PostgreSQL nativo, TSC, banco remoto ou implantação nesta entrega.

Readiness permanece dependente do futuro comando: origem de registro comprovada, ausência/gestão explícita de dependências, travas de período e revisão, alvos ativos e acíclicos em duplicidade/substituição. Guards, reconciliação, candidatos e snapshots de período têm migrações separadas de outros autores. Aliases de recebível estão percorridos pelo resolvedor, mas esta suíte não substitui a validação nativa da cadeia fiscal/recebimentos completa.
