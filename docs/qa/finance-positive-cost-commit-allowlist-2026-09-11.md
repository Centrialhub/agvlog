# Allowlist — correção positiva do custo de descarga

Base Git: `c7c6eed5c594e5d8c38f43f377af3c79827de75f`.

A lista exata, hashes SHA256 dos bytes atuais e dependências estão em `finance-positive-cost-commit-allowlist-2026-09-11.json`: 42 arquivos, abrangendo núcleo60519, leitores60700, boundary62534, modal/outbox, histórico/apresentação, contratos, testes e QA desta rodada. Incluir também este documento e o próprio JSON no commit, sem auto-hash circular.

A auditoria por AST TypeScript percorreu161 arquivos importados transitivamente, identificando imports/exports locais e nomes literais de migrations. Nenhuma referência examinada está ausente e nenhuma dependência untracked ficou fora da lista. Dependências já rastreadas constam no JSON como contexto; não são autorização para adicionar outros diffs desses arquivos. Caminhos dinâmicos e o grafo SQL completo não são comprovados por esta inspeção.

Os diffs compartilhados de FinanceExpenses, ExpenseHistoryDetail, ExpenseUnloadingHistory, RecordedCosts, SettlementExpenseContext e PayablePortfolioPanel pertencem à apresentação do custo vigente/histórico desta rodada. ExpenseCostHistory, expenseCostPresentation e seus testes estão incluídos. Não há alteração de configuração ou entry global necessária: a entrada contextual está em ExpenseHistoryDetail.

Exclusão concreta: `src/lib/financial/unloadingCancellationLabels.ts` contém3 rótulos de resolução de cobrança já cancelada, da rodada54915, e não é dependência nova da correção positiva; manter separado. Também excluídos os demais lotes de SSX/motorista/geocoding, forward-chain, manifests antigos, binários, diretórios de publicação e temporários.

Segundo comunicação do coordenador, as3 migrations foram aplicadas nas versões de produção63118/63135/63213, com readiness positivo e acesso raw/anon negado. Este inventário não realizou consulta remota nem certifica aplicação por nome. Os relatos de QA permanecem como evidência contemporânea dos ensaios locais, sem alterar retrospectivamente seus limites.

Antes do stage pelo coordenador, comparar novamente os hashes do JSON. Nenhum stage, commit, publicação ou alteração remota foi executado nesta tarefa.
