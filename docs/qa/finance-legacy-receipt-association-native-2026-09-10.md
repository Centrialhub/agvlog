# Associação de recebimento antigo — revisão independente

**10 testes passaram em PostgreSQL 17.11**. Handle `80695` terminou com exit 0 e log `Disposable PostgreSQL stopped`. Migration `20260910145616_finance_legacy_receipt_associations.sql`, SHA-256 `c0f2ba253350a39f0c8ec117df2f4883ad655fff1e0c65eeddac486fe6fa8848`, igual ao arquivo final no término da execução. Nenhum SQL core foi alterado nesta frente.

Suíte: `scripts/test-finance-legacy-receipt-native-cases.mjs`. Selector `PG_QA_SUITE=finance-legacy-receipt` em `scripts/test-delivery-concurrency.mjs`. Log: `node_modules/.cache/qa-postgres/finance-legacy-receipt-native-2026-09-10.log`.

## Fontes e capacidade atuais

- `20260910024438_finance_receivable_movement_projection.sql`: a baixa canônica cria uma linha em `receivables_payments`, uma projeção antiga em `bank_transactions` e um vínculo em `finance_receivable_movement_links`. Se houver `movement_id`, usa entrada existente e soma alocações `action='receive'` por `payment.amount*100`; caso contrário, cria entrada canônica. Associação legada não pode chamar novamente a baixa.
- `20260910025658_finance_receipt_allocation_corrections.sql`: correção de alocação exclui o pagamento dos totais da obrigação e libera capacidade da entrada. Não representa dinheiro devolvido; cria evento em `finance_receipt_allocation_corrections`. A nova associação deve compartilhar essa capacidade e preservar a distinção.
- Devolução real (`receivable_payment_reversals`, ação `reverse`, refinada por `20260910030634`) conserva entrada original e registra saída distinta. Sua existência não torna novamente disponível a capacidade da entrada para outra baixa.
- `finance_private.receipt_movement_options` e `project_receivable_command` devem calcular a mesma capacidade incluindo associações legadas ativas. Somente corrigir a consulta de opções deixa uma corrida/overbooking no escritor; somente corrigir o escritor oferece opções inválidas.
- `load_payments.receivable_payment_id` e `closing_report_payments.canonical_receivable_payment_id` são projeções por ID. Não somar uma segunda vez. Banco antigo sem ID correspondente ou com referência a outra origem exige rejeição/revisão explícita.
- `20260910032730_finance_movement_receipt_trace.sql` lê vínculos por comando financeiro. Histórico da associação legada precisa de representação própria e autoria permanente, sem transformar um pagamento em várias linhas monetárias.

## Ordem e cenários nativos executados

O escritor de recebíveis já adquire `fiscal:<tenant>` antes de `<tenant>:finance` e depois o grafo do recebível. O novo comando deve manter ordem compatível; também revalidar autorização e revisão depois da espera.

Executados: duas associações disputando a mesma entrada; duas chaves disputando o mesmo pagamento; replay simultâneo; associação versus baixa real com `movement_id` em títulos diferentes, nas duas ordens; desfazer associação versus reassociação; revisão obsoleta após mudança da fonte; revogação durante espera; correção de alocação e devolução com semânticas distintas. Disputas comprovaram espera por `pg_blocking_pids`. As rejeições de capacidade não deixaram comandos parciais.

A entrada existente possui R$ 500, cada alocação concorrente tenta usar R$ 300. Somente uma é confirmada. Snapshots completos do recebimento antigo, recebível, linha bancária e movimento permanecem iguais durante associação, reversão de associação e rejeições, salvo a alteração externa explicitamente testada.

Após associação, a devolução real executada por `apply_receivable_financial_command` cria a saída de R$ 300; `receipt_movement_used_cents` continua reservando R$ 300 da entrada original e outra alocação de R$ 300 é rejeitada. Em outro caso, `correct_finance_receipt_allocation` sobre pagamento canônico libera a capacidade e a associação que aguardava o lock passa, sem criação de dinheiro pela correção.

A revisão obsoleta usa alteração legítima de `receivables.description` durante espera no lock financeiro. Retorna `40001 / finance_legacy_receipt_changed`, sem associação ou comando. Nenhum gatilho foi desativado para permitir essa alteração.

## Fixture e limites

Tabelas de clientes, recebíveis, pagamentos, banco, faturas, fechamento e dependências do inventário extraídas do baseline com tipos/defaults/chaves primárias reais. Pagamentos históricos foram inseridos **antes** da migration que instala a guarda de inserção versionada. A migration financeira `20260830183929` foi instalada integralmente, seguida pelas migrations reais de projeção, correção, devolução, auditoria, inventário e associação. As chamadas concorrentes de receber, corrigir e devolver são os escritores reais, com seus snapshots, locks, verificações e recálculos.

O cenário é de recebíveis manuais sem fatura/fechamento/fiscal associado. O endpoint de fechamento nesta fixture é indisponível e falha explicitamente; não foi substituído por uma aprovação fictícia. As tabelas auxiliares de vínculos de outras origens/créditos preservam definições, mas omitem FKs para grafos não exercitados. O ensaio não prova emissão fiscal, lifecycle de cobrança, todas as permissões/estados possíveis nem performance de volume. As outras suítes PGlite e testes de integração cobrem essas frentes conforme seus relatórios.

A revisão identificou que `load_payments` pode ser uma projeção exata do mesmo pagamento, não uma origem concorrente. O autor corrigiu o SQL para aceitar somente ID, conta, valor e data coerentes e incluir essas projeções na revisão/snapshot. A execução nativa leu o hash já corrigido; os casos específicos de alias são testados pela frente SQL do autor.

Não houve acesso ou implantação remota. Associação conserva rastreabilidade, mas não atesta autenticidade bancária ou libera fechamento.
