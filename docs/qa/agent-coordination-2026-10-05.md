Estado posterior: pacote manual entregue para mesclagem sob autorização explícita; fonte original preservada. Tarefa atual prepared-updates-20261005/CodexMerge, com inputs e pendências em prepared-updates-merge-2026-10-05.md. Não editar manual-updates após o handoff; próximos ajustes pertencem ao worktree atribuído e à fila. O gate de coordenação agora tem10 testes.

# Entrada local AGVLOG — 2026-10-05

Abra F:\AGVLOG para coordenação e F:\AGVLOG\work\manual-updates para as novas alterações manuais de Thomaz. A integração cumulativa fica em F:\AGVLOG\integration, branch integration/local; ela recebe commits somente pela fila. Base inicial: 63278f7ef77dd1c4e0db7d9e7219ca48280ee18a, informado pelo release.json público; main/a0c9771 não representa esse frontend. Isto não valida comportamento, banco ou Edge Functions.

## Trabalho manual agora

A tarefa manual-updates pertence a Thomaz e reserva ** enquanto durar o trabalho invasivo. Nenhuma demanda nova foi implementada. Antes de editar ou testar:

    node F:/AGVLOG/agvlog.mjs check --task manual-updates --owner Thomaz --cwd F:/AGVLOG/work/manual-updates

Depois de editar, selecione os caminhos específicos (separados por vírgula; não use add -A):

    node F:/AGVLOG/agvlog.mjs stage --task manual-updates --owner Thomaz --files src/caminho/arquivo.ts
    node F:/AGVLOG/agvlog.mjs commit --task manual-updates --owner Thomaz --message "Descrição da mudança manual"

Antes de solicitar testes e consolidação, finalize as alterações manuais. Não há commit final de entrega preparado.

## Agentes paralelos

Cada tarefa tem dono, propósito, arquivos explícitos e worktree próprio baseado no HEAD atual da integração. Exemplo após a reserva manual terminar:

    node F:/AGVLOG/agvlog.mjs new --task ajuste-a --owner agente-a --purpose "Corrigir um fluxo" --files src/arquivo-a.ts

Dois agentes podem trabalhar em arquivos distintos; não editem o mesmo diretório nem publiquem branches isoladas. Branches task/* são unidades temporárias preservadas, não linhas concorrentes de release. Check exige checkout/branch/dono corretos, ancestralidade e base atual. O comando claim amplia propriedade sem invadir outra tarefa. Depois de commits e árvore limpa:

    node F:/AGVLOG/agvlog.mjs enqueue --task ajuste-a --owner agente-a
    node F:/AGVLOG/agvlog.mjs integrate

Um lock exclusivo serializa alterações do coordenador e a fila FIFO. Um item criado antes da integração anterior é recusado. Com árvore limpa, sync mescla a integração atual na própria tarefa, preserva todos os commits e exige nova submissão:

    node F:/AGVLOG/agvlog.mjs sync --task ajuste-a --owner agente-a

Conflito permanece no worktree para análise; não há reset/abort automático. Resolva somente arquivos atribuídos, marque as resoluções com git add explícito e use resolve-sync. Uma fila/conflito/lock abandonado exige inspeção do responsável; não apague locks desconhecidos. Se integração já estiver em conflito, pare e preserve antes de intervenção específica.

O gate automático depois de cada integração executa apenas os nove testes de coordenação Git, registra SHA e logs em F:/AGVLOG/checks. Esses testes não aprovam aplicação, SQL nem publicação. Uma falha mantém commits e bloqueia a entrega. Antes do release final: árvore combinada, CI validate, todos os shards unit-tests, database-and-e2e, homologação isolada do mesmo SHA/contrato e plano de retorno. Não executar banco ou testes pesados sem coordenação com a frente ativa de frete.

## Preservação e coordenação externa

26 checkouts Windows observados; 20 worktrees compartilham o Git F:/agvlog-main/.git. Nenhuma cópia, branch ou alteração antiga foi apagada, movida ou reescrita. Os backups de 01/10 permanecem e um delta preserva AGENTS originais, dois novos relatórios de QA e o forward incompleto do motorista. Hooks recusam commits/merges/push nas 24 cópias históricas protegidas. Eles não impedem edição direta, --no-verify ou reconfiguração deliberada: siga sempre a entrada e o preflight. Não foram instalados hooks na frente ativa task-2 nem alteradas suas configurações/refs/serviços. Linux anterior continua pausado; não foi instrumentado.

Candidato amplo 340e6db55dc6 e CT-e de45d927f79a continuam preservados e precisam ser reconciliados explicitamente com o publicado antes de adoção. A frente ativa de frete 8547aa8563d6 inclui 63278f7, mas ainda precisa de resultado de homologação e incorporação coordenada nesta integração. Não integrar/puxar/alterar seu checkout ou Git comum enquanto ela estiver ativa. Se o SHA público mudar, o fluxo recusa trabalho até uma reconciliação deliberada.

## Um commit final de entrega

Mantenha todos os commits de tarefas/integração e bundles. Somente depois de Thomaz terminar as demandas, incorporar os candidatos aprovados e validar a árvore combinada, prepare em uma branch de entrega isolada a partir da base publicada reconciliada um único commit com essa árvore. Nenhum squash/rebase das branches compartilhadas. Compare tree hashes e execute os gates no SHA final; a validação de um merge anterior não aprova automaticamente outro SHA. Push, merge remoto, migrations e deploy dependem da autorização de publicação e do plano de retorno, ainda pendentes. Os comandos gerenciados e pre-push recusam publicação.

## Mapa observado antes da instalação

| Checkout | Branch | HEAD | Entradas status | Papel |
| --- | --- | --- | ---: | --- |
| F:/agvlog-main | main | 4089f4646262 | 1603 | legado preservado |
| C:/Users/Thomaz/.codex/worktrees/client-literal-search-fix/agvlog-main | detached | f36b01448a35 | 0 | legado preservado |
| C:/Users/Thomaz/.codex/worktrees/cte-billing-prod/agvlog-main | detached | a0c9771cf7db | 10 | CT-e separado pausado |
| C:/Users/Thomaz/.codex/worktrees/finance-corrections-main/agvlog-main | codex/finance-payment-cost-center | 0c4243404dfa | 0 | legado preservado |
| C:/Users/Thomaz/.codex/worktrees/freight-release/agvlog-main | codex/freight-release | 7be7c2f5de2c | 0 | legado preservado |
| C:/Users/Thomaz/.codex/worktrees/ingestion-337-release/agvlog-main | codex/ingestion-337-release | ebf6c46ea77a | 0 | legado preservado |
| C:/Users/Thomaz/.codex/worktrees/nf-import-release/agvlog-main | codex/nf-import-release | 17a7592dca01 | 0 | legado preservado |
| C:/Users/Thomaz/.codex/worktrees/nfse-postal-release/agvlog-main | codex/nfse-no-viacep-gate | 882bf37b118b | 0 | legado preservado |
| C:/Users/Thomaz/.codex/worktrees/production-stability/agvlog-main | codex/production-stability | 0660cbd70ccb | 7 | legado preservado |
| C:/Users/Thomaz/.codex/worktrees/publish-main-review/agvlog-main | codex/publish-main-review | 16d65a2c72ed | 0 | legado preservado |
| C:/Users/Thomaz/.codex/worktrees/sicoob-pix-main-publication/agvlog-main | codex/sicoob-pix-import | 7a46fa90faa4 | 0 | legado preservado |
| C:/Users/Thomaz/.codex/worktrees/third-wave-review/agvlog-main | codex/third-wave-review | 17a7592dca01 | 0 | legado preservado |
| F:/agvlog-main/.codex-build-audit/billing-verify-20260831 | detached | 50bc124b89dc | 9 | CT-e separado pausado |
| F:/agvlog-main/.codex-build-audit/fiscal-release-verify-20260831 | detached | e12f7fb520e4 | 70 | legado preservado |
| F:/agvlog-main/.codex-publish/load-creation-release | codex/fix-complete-load-creation | 66a6bbf8805e | 2 | legado preservado |
| F:/agvlog-main/agvlog-geofence-finalization | codex/geofence-finalization | fcb7e65d3f71 | 3 | legado preservado |
| F:/agvlog-main/agvlog-mainagvlog-geofence-release | codex/geofence-release | 4c0a0f6a513b | 2 | legado preservado |
| F:/agvlog-main-release-20260901 | detached | b11948d1a1f7 | 0 | legado preservado |
| F:/agvlog-main-release-check | detached | e5c2ded48cee | 0 | legado preservado |
| F:/agvlog-main-release-final | detached | 9487ae2de1cb | 0 | legado preservado |
| F:/agvlog-main/agvlog-geofence-lf | codex/geofence-finalization | 90614d60e205 | 2 | legado preservado |
| F:/agvlog-main/.codex/sites-checkouts/agvlog-autofill-20260915 | main | 9dd96d7f8407 | 5 | legado preservado |
| C:/Users/Thomaz/Documents/Codex/2026-10-01/task/canonical | codex/stability-integrated-20261001 | 340e6db55dc6 | 1 | candidato amplo pausado |
| C:/Users/Thomaz/Documents/Codex/2026-10-01/task/billing | codex/cte-billing-isolated-20261001 | de45d927f79a | 0 | CT-e separado pausado |
| C:/Users/Thomaz/Documents/Codex/2026-10-01/task-2/hotfix | hotfix/nfse-configured-freight-20261001 | 63278f7ef77d | 0 | ativa: não tocar |
| C:/Users/Thomaz/Documents/Codex/2026-10-01/task-2/automatic-freight | hotfix/automatic-freight-20261002 | 8547aa8563d6 | 0 | ativa: não tocar |

Status acima é um retrato anterior aos marcadores AGENTS; números não classificam cópias como descartáveis. Metadata atual e histórico da fila: node F:/AGVLOG/agvlog.mjs status. Fonte de preservação: C:/Users/Thomaz/Documents/Codex/2026-10-01/task/organization-20261005.
