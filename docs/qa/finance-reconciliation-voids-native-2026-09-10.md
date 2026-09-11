# Conciliação e movimentos invalidados — PostgreSQL nativo — 10/09/2026

**5 testes passaram** em PostgreSQL17.11 local. Execução final10426 terminou exit0; servidor encerrado. Primeira execução99828 terminou exit1/stopped por erro do adapter JavaScript (Promise enviada como textoSQL), corrigido exclusivamente no runner.

Script: `scripts/test-finance-reconciliation-voids-native-cases.mjs`. Selector: `PG_QA_SUITE=finance-reconciliation-voids`. Log final: `node_modules/.cache/qa-postgres/finance-reconciliation-voids-native-2026-09-10.log`.

Migration183442 SHA256 `1ace7642c0c66c131627b5d860f0289782d8b5ff2c48bc2e21d96dc0ad206ac8`.
Foundation182541 `1085d55520ecf05a34ca2c5a64e22e2830b64cdb906b2ef5aa37a07d8d09d74a`.
Writer184213 `8fbcdb2344bb125fa68f61647ce36c91db95f71e55eba09a4c7e24a746aebf3c`.
Demais hashes de toda a cadeia instalada constam no log.

## Provas

1. Bytes OFX sintéticos passam pelo parser real, intakeRPC, inspeção da fonte, `verifyStatementSource` real e RPCservice_role de registro da verificação. O movimento inicialmente aparece como candidato; após owner-void, desaparece, contexto é recusado e workerSQL automático não cria conciliação. Entradas bancárias e linhas importadas permanecem iguais byte a byte na representaçãoJSON consultada.
2. Duas representações brutas com mesma referência, apenas uma ativa: novo movimento vem do RPCreal com184213; automação associa exclusivamente o ativo e o schema real de histórico confirma ausência de issue.
3. Invalidação owner posterior de movimento associado provoca `movement_inactive`. RPCreal de reversão funciona, preservando snapshotoriginal e todas as linhas/entradas bancárias. Schema real de histórico reconhece issue/reversão.
4. INSERT residual de grupo com movimento invalidado rejeita exatamente23514/`finance_reconciliation_movement_inactive`, sem novo grupo.
5. SessãoA segura linha de grupo; sessãoB obtém financeadvisory e espera pela linha. Após comprovar espera com `pg_blocking_pids`, A tenta INSERT de grupo: exatamente40001/`finance_dependency_busy`. Subtransação reverte, A libera linha, B conclui. Não há40P01 aceito como sucesso. Permanece um único grupo e o extrato é inalterado.

## Limites

Nenhum comando público de void foi criado ou presumido. Invalidações são owner-only fixture; a invalidação sobre conciliação ativa testa defesa de leitura/histórico, não autoriza o futuro comando a ignorar vínculos. Não há autenticação de extrato externo: os bytes são sintéticos. `authorize` do adapterworker usa a identidade fixture; o RPC de verificação conserva a autorização real do ator no banco. O bucket/storage é schemaestreito da factory; não executa serviçosHTTP de storage.

Instala a sequência declarada por `setupFinanceStatementIntakeDatabase` e182541/182830/183442/184213, sem substituir funções de verificação/automação por stubs de sucesso. É um grafo de dependências focado; não ensaia todas as migrations ou deploySupabase completo. Nenhuma alteraçãoSQL de produto ou acesso remoto nesta rodada. PostgreSQL parado ao final.
