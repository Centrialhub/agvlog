# Folha: concorrência de geração, aprovação e ajustes

## Problemas encontrados na leitura

- A nova geração segura `payroll_periods FOR UPDATE` no preflight (`20260910132406_finance_payroll_reimbursement_source_dedup.sql:96`), mas a aprovação anterior primeiro recomputava/bloqueava entries (`20260824224152_baseline.sql:10305`, chamada ao UPDATE da linha 10017) e somente ao final atualizava o período (10333). Geração segurando período e aprovação segurando entry podiam formar espera circular.
- `recompute_payroll_entry_totals` somava itens e escrevia valores sem validar estado protegido (`baseline:10001`, `10017`). Os métodos de ajuste e o trigger anterior verificavam estado com SELECT sem lock (`baseline:11181`, `11209`) e podiam atravessar a aprovação com valores lidos antes da transição. O título aprovado poderia ficar distinto dos totais alterados depois.
- O boundary de RPC `20260909235237` acrescenta autorização, mas não uma ordem de locks. A projeção `20260910000731` altera fechamento, não aprovação/recompute. Políticas legadas permitiam DML direto nas três tabelas de folha (`baseline:22014–22040`).
- Uma hipótese de edição concorrente de despesas já aprovadas foi descartada: `20260830203548_audit_driver_expense_reviews.sql:114` já preserva esses registros como imutáveis. Não foi alegada como bug confirmado.

## Correção candidata

Migration `20260910133352_finance_payroll_lifecycle_serialization.sql`:

- Preserva assinatura, defaults, OID e corpo anterior dos sete comandos: geração, aprovação, fechamento, recompute, recalculate, inclusão manual e exclusão de item.
- Introduz entrada única: autorização → finance advisory do tenant → reautorização → período(s) → entry/entries pertinentes. Geração bloqueia os períodos do tenant; operações sobre uma entry não relêem/travam toda a folha histórica a cada recompute.
- Revalida estado após esperar. Períodos/entries protegidos não podem ser alterados pelo recompute público ou por ajustes enfileirados antes da aprovação.
- Aprovação recomputa antes de proteger, como transição válida; ignora entries canceladas tanto no recompute quanto no bloqueio de seus itens.
- Revoga INSERT/UPDATE/DELETE e privilégios de manutenção do browser sobre `payroll_periods`, `payroll_entries`, `payroll_entry_items`, preservando leitura e comandos. Triggers de defesa em escrita privilegiada usam try-advisory/NOWAIT, evitando esperar finance depois de já adquirir row lock em ordem inversa.
- Histórico aprovado permanece protegido. O fechamento existente pode realizar a transição approved→closed, preservando valores/identidade e alterando apenas campos de fechamento.

## Verificação nativa

**9 testes passaram** em PostgreSQL **17.11** descartável/loopback. Sessão final `33410`, saída 0; servidor confirmado parado pelo runner.

1. Geração primeiro e aprovação aguardando: aprovação usa versão comprometida.
2. Aprovação primeiro e geração aguardando: geração rejeitada sem sobrescrever proteção.
3. Crédito manual primeiro: título aprovado inclui exatamente o ajuste.
4. Aprovação primeiro: ajuste manual enfileirado rejeitado.
5. Recompute aguardando aprovação: rejeitado sem alterar entry/título.
6. Recompute primeiro e aprovação depois: mesma ordem, sem ciclo entry/período.
7. Revogação do operador durante espera: nenhuma escrita de aprovação.
8. DML do browser revogado e escrita privilegiada em valores aprovados bloqueada.
9. Entry cancelada não quebra a aprovação nem é recomputada/protegida novamente.

Os sete cenários de disputa observam sessões reais bloqueadas com `pg_blocking_pids`. Os resultados conferem período, valor a pagar, título e ausência de novos movimentos/pagamentos de acerto. Não executam transações financeiras.

SHA256 final da migration133352: `d596834f30bdfddcd8b2410c9ba3c1a7318129cebd1c3fc1185c40d1f7506311`.

Dependências candidatas usadas: `000731` SHA `88b308914ba6bcc1d718920f82b391cf60afce7f76a2b7715d3b7c3d641097d3`; `132406` SHA `d335fc5dcd74d283255283824ac7b39c3ed9f7160a87576d586352b125e157f4`. A fixture carrega tabelas/funções da baseline, unique/FKs relevantes e migrations reais, com dependências financeiras mínimas; não é réplica integral de produção.

Arquivos de execução: `scripts/test-finance-payroll-lifecycle-native-cases.mjs`, selector `PG_QA_SUITE=finance-payroll-lifecycle` em `scripts/test-delivery-concurrency.mjs`. Ambos passaram `node --check`.

Log: `node_modules/.cache/qa-postgres/finance-payroll-lifecycle-native-2026-09-10.log`.

## Limites

Nada foi aplicado remotamente. Não houve browser ou ensaio integral de migração. Não implementa reabertura/cancelamento auditado de folha, não homologa fontes legadas nem prova integração com todos os writers externos ao inventário local. O novo pagamento canônico de acerto está em outra frente; sua integração deve manter finance → períodos → acerto → entries e só recomputar folhas editáveis.
