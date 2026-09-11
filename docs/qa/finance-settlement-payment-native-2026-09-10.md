# Pagamento canônico de acerto integrado à folha — PostgreSQL nativo

**9 testes passaram em PostgreSQL 17.11** descartável, somente loopback. Execução final sessão38480, saída0; servidor confirmado parado. Nenhuma alteração em SQL, interface ou banco remoto nesta frente.

## Fixture e candidatos

A fixture carrega formas/defaults reais da baseline para acertos, pagamentos, eventos, employees/contratos/adiantamentos/incidentes, despesas, períodos/entries/itens/issues de folha e títulos/pagamentos. Inclui FKs de entry→período e item→período/entry, uniques de entry e título. Geração/aprovação/recompute são os corpos reais da baseline com as migrations candidatas atuais. Portanto os cenários de folha não usam uma tabela vazia simplificada para alegar integração.

As dependências de capacidade de despesas/títulos seguem a fixture de `financeSettlementPaymentDatabase.ts`: tabelas reais de alocação e projeção de pagamentos ativos, porém `finance_expense_items` é mínima. Não foi alegada integração com o comando completo de despesa nesta suite.

| Candidato | SHA256 da execução |
|---|---|
| 20260910000731_finance_payroll_payment_projection.sql | 88b308914ba6bcc1d718920f82b391cf60afce7f76a2b7715d3b7c3d641097d3 |
| 20260910130540_finance_settlement_movement_links.sql | a05183495df24000b81fd2976a6723df0c4700dbdf2d82b5dca679e47e1f1205 |
| 20260910132406_finance_payroll_reimbursement_source_dedup.sql | d335fc5dcd74d283255283824ac7b39c3ed9f7160a87576d586352b125e157f4 |
| 20260910133352_finance_payroll_lifecycle_serialization.sql | d596834f30bdfddcd8b2410c9ba3c1a7318129cebd1c3fc1185c40d1f7506311 |
| 20260910133355_finance_new_settlement_payment_candidates.sql | 2228320c5bb307153155b0b33303f23c40da047efa2485551ae784d38576ef18 |
| 20260910133421_finance_settlement_payment_recording.sql | 33d7164beccdc66e575fc9e75801acb7fcdf0f4d90cb0563a8abfd9a7abbaee8 |
| 20260910133700_finance_retire_legacy_settlement_payment_writers.sql | 8cefdf5c92a4bfbd979a2685de8c46edbad0b31d5751453297d676aeb7545595 |

## Cenários

1. Mesmo request aguardando outro request idêntico: um pagamento, vínculo e item `already_paid`, com resultado de replay idêntico.
2. Duas chaves diferentes disputando saldo de um acerto: segundo pagamento não ultrapassa a dívida efetiva.
3. Dois acertos disputando uma saída: segunda gravação não ultrapassa capacidade compartilhada.
4. Pagamento antes de geração: regeneração reaproveita a fonte do pagamento uma vez.
5. Geração antes de pagamento: pagamento acrescenta `already_paid` à versão comprometida e recomputa.
6. Pagamento antes de aprovação: título aprovado já desconta R$300 efetivamente registrados (R$1500 de crédito → R$1200 a pagar).
7. Aprovação antes de pagamento: bloqueio da folha protegida impede qualquer pagamento/vínculo/item parcial e preserva o título em R$1500.
8. Revogação de acesso durante espera: nenhum efeito de pagamento ou comando persistido.
9. INSERT privilegiado sem vínculo: `SET CONSTRAINTS ALL IMMEDIATE` rejeita pela constraint de cutoff, com rollback completo.

Os oito primeiros usam sessões concorrentes reais e verificam bloqueio por `pg_blocking_pids` antes de liberar o holder. As gravações do comando executam explicitamente `SET CONSTRAINTS ALL IMMEDIATE`, além do commit, para verificar a constraint diferida na mesma transação.

As verificações conferem conteúdo e contagem dos movimentos existentes, pagamentos, vínculos, itens de folha, `already_paid_amount`, `amount_to_pay`, estado do período e títulos nos cenários de aprovação. Não é criado movimento, linha bancária ou despesa adicional.

## Reprodução e limites

Selector: `PG_QA_SUITE=finance-settlement-payment`, executado por `node --experimental-strip-types scripts/test-delivery-concurrency.mjs`.

Arquivo novo: `scripts/test-finance-settlement-payment-native-cases.mjs`. Runner central alterado somente para selecionar esta suite. Ambos passaram `node --check`.

Log: `node_modules/.cache/qa-postgres/finance-settlement-payment-native-2026-09-10.log`.

Isto verifica os cenários listados contra os hashes acima. Não substitui ensaio integral de migração/produção, browser, revisão de todos os writers operacionais ou homologação de folhas históricas. A geração é exercitada com remuneração do contrato e crédito de acerto sem reembolso: deduplicação de reembolsos detalhados permanece coberta pelos testes específicos dessa outra migration, não por esta suite.
