# Associação de pagável antigo — revisão e ensaio nativo

Suíte `scripts/test-finance-legacy-payable-native-cases.mjs`: **12 testes passaram em PostgreSQL 17.11**. Execução final handle `23299`, exit 0; log confirma `Disposable PostgreSQL stopped`. Nenhum SQL core foi alterado por esta frente.

Migration executada `20260910143833_finance_legacy_payable_associations.sql`, SHA-256 `2948e859d766cbff838a170ab288b543bf0d133412e9ba526d1f7fdb3125e529`.

Reprodução: `PG_QA_SUITE=finance-legacy-payable node --experimental-strip-types scripts/test-delivery-concurrency.mjs`. Log `node_modules/.cache/qa-postgres/finance-legacy-payable-native-2026-09-10.log`. Selector adicionado no runner central, preservando as demais suítes.

## Revisão independente do contrato anterior

- `20260910003529_finance_payable_link_reversal.sql:106–116`: histórico fazia join de todos os vínculos por pagamento e contava linhas resultantes. Com reassociação, duplica pagamento, total e paginação. Deve selecionar relação ativa/recente e manter histórico de associações separadamente.
- Mesma migration, linhas 15–18: `active_payable_payments` excluía pagamento se qualquer associação fosse revertida. Associação de um pagamento já realizado tem semântica distinta de cancelar sua baixa; a origem histórica precisa continuar paga após desfazer somente a associação.
- `20260910002244_finance_payable_movement_links.sql:57`: `protect_linked_payment` usa existência de qualquer histórico, não seleção de um vínculo. A proteção continua pertinente após múltiplas associações e não deve ser enfraquecida.
- `20260910121937_finance_retire_legacy_payable_writers.sql:9`: constraint diferida é aplicada a novos pagamentos, exigindo vínculo e `bank_transaction_id IS NULL`. A adoção deve trabalhar com linha antiga existente, não reinseri-la ou apagar seu ID bancário para atender ao novo escritor.
- `20260910142740_finance_legacy_adoption_inventory.sql`: exclusão de pagável por qualquer vínculo e filtro de pagamentos de adiantamentos revertidos precisam considerar a nova origem `legacy_adoption`, para reabrir associação pendente sem inventar uma nova saída e sem apagar o dinheiro do adiantamento.

Achados comunicados ao autor do SQL antes da execução. Os agregadores de capacidade já excluem vínculos revertidos por ID; essa regra continua adequada à liberação de capacidade. Nenhuma seleção de vínculo único foi encontrada nesses agregadores.

## Matriz executada

Replay simultâneo; duas chaves disputando um pagamento; associação concorrendo em ambas as ordens com baixa canônica, lote de despesas e associação de acerto na mesma saída; reversão concorrente com reassociação; tentativa privilegiada de editar/excluir pagamento associado; revogação do autor durante espera comprovada.

Fixture usa tabelas monetárias/operacionais/folha do baseline com tipos, defaults e chaves primárias reais. Pagamentos antigos são semeados antes do cutoff que proíbe novos escritores legados. As funções reais de recálculo do título, capacidade, lote, baixa, associação de acerto, inventário e associação candidata são instaladas a partir das migrations. O ensaio compara snapshots completos do título antigo, seu pagamento, linha bancária e movimento; disputas comprovaram bloqueio por `pg_blocking_pids`. Não houve acesso remoto.

As duas chamadas disputando capacidade tentam usar R$ 300 cada de uma saída de R$ 500; apenas uma alocação é confirmada. Quando a associação histórica perde, seu comando não persiste. Na reversão/reassociação, duas linhas históricas permanecem, uma associação fica ativa e `active_payable_payments` continua contendo exatamente o pagamento original. Edição/exclusão privilegiada do pagamento associado falha. Após revogação durante espera, nem associação nem comando parcial são registrados.

Todas as associações agora capturam `legacy_payable_source_revision` na prévia. O 12º caso modifica o valor da linha bancária durante espera comprovada no lock financeiro: a associação com revisão anterior retorna SQLSTATE `40001`, `finance_legacy_payment_changed`, sem vínculo ou comando parcial. Título, pagamento e movimento permanecem iguais à prévia; somente a alteração externa explícita da fonte bancária persiste. A tentativa de alterar o pagamento antes da associação também é negada pela imutabilidade do cutoff; não foram desativados gatilhos para simular um escritor inexistente.

## Limites

Primeiros ensaios corrigiram somente a fixture: inclusão de `storage.objects` exigida pela dependência de despesa manual e uso de viagem real para o lote que consome saída de motorista. Não foram tratados como aprovação dos cenários que ainda não haviam executado.

O cenário concorrente de acerto usa o comando real de associação de pagamento de acerto já existente, verificando a mesma capacidade compartilhada; não executa geração de folha ou novo pagamento de acerto nesta suíte. FKs para grafos de recebíveis irrelevantes ao caso e catálogo de storage são reduzidos na fixture. Não é aplicação integral de todas as migrations, auditoria de writers privilegiados de todas as tabelas, benchmark de volume nem aprovação de fechamento.

Preservar pagamentos antigos e vincular uma saída existente não atesta autenticidade bancária. Outras origens históricas, ambiguidades de documentos e carteira inicial continuam fora desta implementação.
