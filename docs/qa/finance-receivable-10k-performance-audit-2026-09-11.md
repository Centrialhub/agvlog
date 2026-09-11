# Recebíveis: medição local de 10 mil títulos

A exigência está em `docs/planejamento-financeiro-2026-09-09.md:424`: medir p95 de busca/filtros com pelo menos 10 mil títulos e concorrência representativa. A busca no QA anterior encontrou funcionalidade com 1.005 títulos, mas nenhuma medição financeira com 10 mil.

## Reprodução

- `node scripts/benchmark-finance-receivables-10k.mjs`: PGlite.
- `node scripts/benchmark-finance-receivables-native.mjs`: PostgreSQL 17.11 descartável, loopback, conexão psql persistente; encerra o cluster em finally.
- Os dois executam a mesma fixture real de invoice/fiscal/crédito, predecessores capturados e migrations publicadas 01312/04429. Nenhuma função produto foi alterada.
- 10.000 títulos manuais pendentes de R$100, 20 clientes sintéticos, sem pagamentos/créditos/eventos nesses títulos. Contagem global 10.000 e aberto 100.000.000 centavos; por cliente 500 e 5.000.000 centavos. Busca `title 999` encontra 11. Páginas 1 e 200 retornam 50 cada.
- Índices reais de receivables, receivables_payments, reversals e application_events foram capturados por SELECT e restaurados na fixture quando ausentes. Outras tabelas de evidência estão vazias; não representa distribuição histórica real nem concorrência.
- JSONs incluem catálogo normalizado, hashes SHA256 das migrations, índices, amostras brutas e EXPLAIN ANALYZE/BUFFERS no PG. p95 empírico usa a amostra ordenada ceil(0,95*n), exclui aquecimento; 20 amostras. PGlite global limitado a cinco amostras, sem anunciar p95.

## Diagnóstico concreto

O agregado `finance_private.receivable_portfolio_summary` materializa todos os títulos e chama `_receivable_financial_snapshot` para cada um. O snapshot consulta `_receivable_ledger_evidence`; a integração01312 acrescenta novamente `receivable_credit_evidence` e `cash_receivable_ledger_evidence`, já usados pelo ledger combinado. Portanto existe repetição de provas por título, não só uma soma sobre colunas.

A paginação calcula contagem filtrada global, mas `receivable_credit_list_fields` fica restrito aos 50 itens da página. Isso explica uma hipótese causal consistente com a diferença medida; EXPLAIN externo da função é opaco e não demonstra sozinho o tempo de cada helper. Não foi feita instrumentação interna de frequência por pg_stat_functions nesta rodada.

`src/pages/Receivables.tsx:66` consulta a carteira global sem filtro. `src/hooks/useReceivablePortfolio.ts` mostra Consultando durante fetching e não define staleTime próprio; logo a demora afeta os cartões da tela apesar da página rápida.

Próximo passo limitado: perfil interno de ledger/snapshot e proposta de agregado em lote ou reutilização de uma única prova por título, preservando falha por evidência inválida, dinheiro/crédito separados, cancelamentos e totais globais. Nenhuma otimização autorizada por este relatório e nenhuma alteração SQL produto feita.

## Limites

Os tempos são locais de banco/transportes de fixture, não p95 de produção ou E2E. Transporte nativo inclui polling de 10ms; EXPLAIN informa tempo servidor separado. shared_buffers=32MB no cluster descartável. Não houve teste de volume concorrente representativo; portanto a meta integral do plano permanece não homologada. Nenhum documento fiscal foi emitido ou dado de produção modificado.

## Resultado final

PostgreSQL17.11, sessão42778, saída0; cinco cenários concluídos e cluster confirmado parado. Vinte amostras medidas após aquecimento por cenário:

| Consulta | p95 local | EXPLAIN servidor |
|---|---:|---:|
| Página1, 50 de10.000 |100,15ms|85,98ms|
| Página200, 50 de10.000 |113,37ms|87,59ms|
| Busca, 11 encontrados |44,81ms|25,43ms|
| Carteira global, 10.000 |14.891,31ms|14.160,73ms|
| Carteira por cliente, 500 |759,62ms|711,64ms|

Agregação global:860.185 shared hit blocks, zero shared read blocks,2.139 temp read blocks e6.370 temp written blocks. Portanto o gargalo aparece mesmo com dados em cache; há materialização temporária. O plano externo não identifica qual CTE derramou, logo atribuir exclusivamente a um helper seria prematuro.

PGlite, sessão16735 saída0: páginas p95 54,62/53,52ms, busca22,00ms, carteira por cliente260,78ms; global cinco amostras4.960–5.067ms após aquecimento5.224ms. Não usar essa diferença entre runtimes como previsão de produção.

Hashes MD5 de funções conferidos com SELECT de produção: portfolio57b41ad9b959e236163ecb2e2cc590ac; page8585c392e5d51874380f094c913098e3; originpage35dc6d2153bde484f39ee1440ee8a680; snapshot473e509e0283627f5520dddfb36a083d. Dados sintéticos e nenhum write remoto.

Os scripts não interpretam ausência de erro como performance aprovada. A mensagem genérica do transporte `0 functional gaps` refere-se às asserções de contagem/valores, não à latência: existe gargalo comprovado na carteira global.
