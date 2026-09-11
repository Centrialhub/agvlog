# Reautorização do publicador de verificações

Alvo: `20260910142923_finance_statement_verification_reauthorization.sql`, implementado pelo root. Este ensaio não altera SQL. SHA256: `9ce386f8a93b46865569099495f6a47935b207f51f6fdee8c932bc1f8763273f`.

`scripts/test-finance-verification-reauth-native-cases.mjs` instala o ledger e as migrations reais de intake/source verification em PostgreSQL 17.11 descartável; então aplica o patch e chama a RPC real como service_role. Os imports/linhas de entrada são fixture direta; não simula download ou parser externo. O publicador real valida revision/file_hash e relatório antes de persistir verificações, eventos e comandos.

Casos definidos:

1. Ator autorizado aguarda finance lock e registra uma verificação real; replay não duplica.
2. Membership desativada durante espera bloqueia publicação, com zero verification/command/event.
3. Membership driver adicionada durante espera bloqueia perfil misto, com zero resíduos.
4. Cadastro driver ativo adicionado durante espera bloqueia mesmo sem membership driver.
5. Replay após revogação durante espera é negado; nova chamada já revogada também é negada. A única verificação/evento/comando históricos permanecem intactos.
6. OIDs, ACLs, SECURITY DEFINER/configs são iguais antes/depois; execução é service-only e browser autorizado ao financeiro não pode publicar diretamente.

As cinco corridas usam `contested` e comprovam bloqueio com `pg_blocking_pids` antes de alterar elegibilidade e liberar o holder. Não usam sleep como prova. ACL é caso adicional sem corrida.

Resultado: 6/6 testes passaram; processo exit0 e cluster descartável encerrado. Execução: `PG_QA_SUITE=finance-verification-reauth node --experimental-strip-types scripts/test-delivery-concurrency.mjs`. Log local: `node_modules/.cache/qa-postgres/finance-native-verification-reauth-2026-09-10.log`.

Sem servidor remoto, alteração de migrations-alvo ou impacto em dados do cliente. O ensaio é da fronteira de publicação e reautorização; não atesta autenticidade do arquivo nem substitui revisão de cobertura/fechamento.
