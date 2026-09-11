# Recebíveis: composição da liquidação — 2026-09-11

Primeira etapa local de consumidores, anterior ao contrato de aplicação/liberação do crédito. Sem migração, publicação ou emissão fiscal.

- `received_amount`/`received_cents` legados são apresentados como **total liquidado**, sem inferir dinheiro recebido.
- Contexto aceita grupo opcional numérico `cash_received_cents`, `credit_applied_cents`, `settled_cents`. Página aceita grupo textual equivalente. Ausência mantém compatibilidade e comunica composição indisponível; valores nulos permanecem indeterminados.
- Grupo parcial, soma divergente ou divergência com o total legado são rejeitados. Contexto com composição desconhecida não pode anunciar capacidade de receber.
- Lista cancelada não mostra valor nominal como dívida em aberto. Quando `open_cents` vier explicitamente do leitor, o valor será preservado.
- Pagamentos e devoluções existentes não recebem eventos artificiais de aplicação de crédito. A aprovação do contrato de escrita e dos catálogos é dependência da próxima etapa.

## Evidências locais

13 testes passaram em quatro arquivos: `receivableSettlementAmounts` (4), `receivablesPagedScreen` (4), `receivableCreditContext` (2), `receivableFinancialAmounts` (3). Casos: crédito 400 e dinheiro 0 em título 500; recebimento posterior 100; composição legada indisponível; composição inválida nula; nominal cancelado sem dívida; parsers compatíveis e rejeição de inconsistência; filtros e paginação existentes.

Lint dos nove arquivos próprios passou. Não executado TSC global nesta etapa. Nenhum teste comprova aplicação/liberação de crédito em produção: os respectivos leitores e comandos ainda estão em desenvolvimento no núcleo.

## Revisão adicional — parser integral e centavos

`credit_revision` (MD5) e `credit_application_count` (todos os eventos apply/release históricos, inclusive liberados) foram confirmados pelo autor do núcleo e aceitos como par opcional para compatibilidade. Valores parciais, revisão inválida ou contagem negativa são rejeitados.

`receivableCreditContextDatabase.test.ts` passou contra a cadeia real do helper `createCustomerCreditApplicationDatabase` + migração 01312 integral. O teste cria o título pelo comando auditado de fatura e passa a resposta **inteira** de `get_receivable_financial_context` para `parseFinancialContext`. Esse caso ainda não contém aplicação de crédito: comprova integração de envelope, sem alegar a prova funcional de aplicação/liberação que está com o autor SQL.

A conversão monetária legada passou a usar representação decimal textual, sem multiplicação/arredondamento: 0.29 → 29; terceira casa (1.005), NaN, infinito, negativo, fora do teto ou null → indeterminado. Composição textual limitada ao teto SQL de 14 dígitos. Dois novos testes monetários passaram, além do teste de metadata do contexto. Total distinto nesta etapa: 17 testes aprovados em seis arquivos. Lint focal dos ajustes passou; TSC global não executado.
