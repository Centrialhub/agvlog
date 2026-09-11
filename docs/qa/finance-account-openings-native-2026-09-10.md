# Abertura bancária — concorrência PostgreSQL nativa

Executados **6 testes com sucesso em PostgreSQL 17.11**, local e descartável. Handle final `39886`, código de saída 0; log confirma `Disposable PostgreSQL stopped`. Nenhum SQL de produção foi alterado e nenhuma operação remota foi realizada.

## Reprodução

Suíte: `scripts/test-finance-account-openings-native-cases.mjs`, selecionada por `PG_QA_SUITE=finance-account-openings` em `scripts/test-delivery-concurrency.mjs`.

Log: `node_modules/.cache/qa-postgres/finance-account-openings-native-2026-09-10.log`.

Migration validada: `20260910140010_finance_account_opening_balances.sql`, SHA-256 `799f25034f6f3964b32e7da896ebffa589d8bb0fc623b03ae1cd1f13e5964c9c`.

Fixture com fundação e consultas reais do ledger, importação, verificação, auditoria, OFX, identificação bancária e evidência de período; mesmas dependências relevantes de `financePeriodEvidence`. Hashes das migrations instaladas constam no log. Não instala a migration posterior de abertura de caixa físico.

## Resultados

Todas as disputas exigem prova de bloqueio entre as conexões por `pg_blocking_pids`, antes de liberar o detentor do lock.

1. Duas chaves diferentes para a mesma conta: uma abertura ativa, segunda recebe `finance_account_opening_exists`; comando rejeitado não persiste.
2. Mesma chave concorrente: segunda chamada espera e retorna o ID original; uma abertura e um evento de auditoria.
3. Reversão primeiro e substituição esperando: duas linhas históricas, uma reversão, apenas uma abertura ativa.
4. Abertura primeiro e reversão esperando: reversão obtém o ID após adquirir o lock; uma linha histórica e nenhuma abertura ativa.
5. Autor perde acesso durante a espera: `finance_access_denied` após liberação, sem abertura nem comando parcial.
6. Verificação nova é confirmada antes da captura da evidência: revisão anterior rejeitada por `finance_opening_evidence_changed`, sem abertura nem comando parcial.

Todos os casos confirmam zero movimentos monetários criados para a conta de teste.

## Limites e ajuste da fixture

A primeira execução terminou com rejeição de âncora porque a fixture repetia a mesma identificação bancária entre contas. A correção foi exclusivamente atribuir uma identificação única por conta e ao respectivo relatório; a segunda execução passou integralmente. Não foi encontrado defeito na migration.

Relatórios de leitura dos extratos são inseridos pela fixture, não extraídos de arquivos nesta suíte. Os testes comprovam serialização e rollback nesses cenários; não atestam autenticidade dos extratos, cobertura integral do período nem fechamento definitivo. A matriz de valores, permissões e subperíodo permanece coberta pelos testes PGlite do relatório de abertura.
