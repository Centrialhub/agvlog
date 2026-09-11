## Validação nativa do resumo da carteira de recebíveis — 2026-09-10

Resultado: 6 testes passaram em PostgreSQL 17.11 local descartável. Execução final 73105 terminou com exit 0 e servidor parado. Nenhuma alteração em SQL de produto ou ambiente remoto.

Arquivos: `scripts/test-finance-receivable-portfolio-native-cases.mjs`; selector `finance-receivable-portfolio` em `scripts/test-delivery-concurrency.mjs`. Log local: `node_modules/.cache/qa-postgres/finance-receivable-portfolio-native-2026-09-10.log`.

Migration 51617 SHA256: `b0fd3bb3785762edbe496d28f48db926bc8c81815ab4448088ca4b768bbd6c50`.
Core 45616 SHA256: `c0f2ba253350a39f0c8ec117df2f4883ad655fff1e0c65eeddac486fe6fa8848`.

### Evidência

- 1.005 títulos ativos de R$100: nominal e aberto exatamente `10050000` centavos, sem limite implícito de mil registros.
- Recebimento parcial de R$25 executado pelo comando canônico real: alocado `2500`, aberto `10047500`, um título parcial. Título cancelado adicional não aumenta nominal/aberto e aparece na contagem separada.
- Filtro de um dia em São Paulo inclui 03:00 UTC e exclui 03:00 UTC do dia seguinte; quatro títulos nas fronteiras retornam exatamente dois.
- Amount NaN, criação infinity e vencimento infinity mantêm o título identificável e invalidam todos os totais monetários. Respostas passam pelo `receivablePortfolioSchema` real, inclusive campos de status e centavos.
- Motorista, perfil misto motorista/operador, tenant estrangeiro e intervalo invertido são rejeitados.
- EXPLAIN ANALYZE executa o corpo completo da query, com snapshot real por título, em vez de medir apenas um Function Scan. Plano registra 1.005 linhas ativas: planejamento **2,076 ms**, execução **198,267 ms**. Medida isolada de fixture local, sem promessa de latência de produção.

### Limites e reprodução

Fixture usa definições baseline de recebíveis e dependências, ledger real e funções reais de recebimento/projeção/correção/devolução/associação. Não instala todo o grafo de FKs nem fluxos fiscais/fechamentos: os títulos são manuais; a função auxiliar de fechamento falha explicitamente caso invocada. Não prova status fiscais nessa suite.

`created_at` NULL é proibido pelo NOT NULL da baseline; não removemos essa restrição para fabricar um estado normalmente impossível. A variante sem data finita foi exercitada com infinity, permitida pelo tipo, e deve invalidar totais mesmo com filtro de período. O ramo específico NULL não foi validado nativamente aqui.

A primeira execução 75624 passou os cinco casos funcionais e falhou somente no EXPLAIN do harness, que não substituía a variável PL/pgSQL `today`. Corrigido o harness, 73105 passou integralmente sem mudança de SQL de produto.

Comando PowerShell: `$env:PG_QA_SUITE='finance-receivable-portfolio'; node --experimental-strip-types scripts/test-delivery-concurrency.mjs`.
