# Revisão independente da carteira de recebíveis

Escopo somente leitura de `20260910151617_finance_receivable_portfolio_summary.sql`, `receivablePortfolioSummary.test.ts` e cadeia real do snapshot financeiro. Não alterei o SQL nem testes do responsável.

## Achados entregues ao responsável

**Correções confirmadas pelo responsável:** migration51617 agora materializa o snapshot uma única vez em CTE e exige ausência de `fiscal_block_reason`; vencimento não finito invalida totais. O responsável executou oito testes, incluindo bloqueio fiscal com `requires_reconciliation=false` e vencimento `-infinity`. Os achados abaixo registram a versão revisada antes desses ajustes, não pendências atuais. O limite de desempenho continua aplicável.

1. **Bloqueio fiscal ignorado na validação dos totais.** Linha24 da versão revisada considera somente `requires_reconciliation`. Migration12152 acrescenta `fiscal_block_reason` e desliga `can_receive` sem modificar esse booleano. Um título pendente com grafo monetário equilibrado e origem fiscal indisponível pode permanecer dentro dos valores a receber válidos. A validação deve considerar separadamente `fiscal_block_reason is null`; `can_receive` não serve como substituto porque é false para títulos já recebidos integralmente. Teste necessário com origem fiscal indisponível e saldo monetário zero equilibrado.

2. **Vencimento infinito produz KPI enganoso.** Linhas16–21 validam criação/valores, mas não `due_date`; linha33 considera `due_date<today`. Assim `-infinity` torna a obrigação vencida sem uma data válida, e `infinity` evita vencimento indefinidamente. Recomendo bloquear totais quando vencimento não nulo não finito. Data de vencimento nula pode continuar representando ausência de prazo definido, conforme regra de produto, sem inventar vencimento.

## Aspectos adequados

Filtro de títulos é sempre por tenant, e filtro de cliente explícito exige existência nessa empresa. Limites de dia de criação usam São Paulo, limite superior exclusivo do dia seguinte. Datas de criação inválidas não desaparecem do intervalo: invalidam totais. Todos os totais, inclusive agrupamentos de status, ficam nulos se houver título ativo inválido. Não há limite1000. Cancelados ficam em contagem separada e seus valores não entram na carteira ativa. Os recebidos apresentados são alocações nos títulos, não saldo bancário.

## Limites e testes adicionais

O snapshot constrói histórico de até500 pagamentos, lista de contas e evidências por título. A nova consulta chama esse caminho para cada título ativo. As1005 linhas de teste comprovam ausência de truncamento, não capacidade operacional em carteira com milhares de pagamentos. Medir latência/planos e considerar helper de integridade monetária sem montagem de histórico, preservando todas as provas.

Histórico de pagamento monetariamente corrompido pode fazer o snapshot lançar erro ao converter cents para bigint antes de devolver `requires_reconciliation`; o novo guard só valida valores do título. Isso bloqueia a resposta inteira, sem apresentar soma errada, mas difere de uma resposta diagnosticável com totais nulos. Não engolir indiscriminadamente erros SQL; uma futura leitura defensiva deve classificar dados inválidos explicitamente.

Testes ainda desejáveis: cliente local com títulos de outro cliente, cancelamento real/crédito e devolução, vencimento nulo/infinito, bloqueio fiscal, inconsistência de cache recebido versus pagamentos. A semântica temporal é criação do título, não data de recebimento; manter essa informação na interface para evitar interpretação como fluxo de caixa do período.

Atualização do coordenador: os dois achados foram corrigidos em51617. O snapshot é materializado uma vez por título e exige fiscal_block_reason ausente; due_date não finita invalida a soma. Oito testes SQL reais passaram, incluindo snapshot equilibrado com fonte fiscal bloqueada, vencimento -infinity, 1005 títulos, baixa parcial e limites civis de São Paulo. Limites de custo da consulta e falha fechada em evidência profundamente corrompida permanecem aplicáveis.
