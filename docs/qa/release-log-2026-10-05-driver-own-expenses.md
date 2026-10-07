# Log de release - despesas operacionais próprias do motorista - 05/10/2026

Registro baseado no template permanente `release-log-template.md`. Preparação local, sem publicação ou aplicação em banco compartilhado. O incidente histórico de 26/09 permanece intacto.

## Identidade e estado

| Campo | Valor |
| --- | --- |
| Responsável local / revisor DB e fluxos | CodexMerge / revisor independente coordenado pelo responsável da sessão |
| Tarefa e worktree | `driver-own-expenses-20261005`, `F:/AGVLOG/work/driver-own-expenses-20261005` |
| Fonte imutável do revisor | `prepared-updates-20261005`, `8673e7ae903d34fdb65fc3e6f27a60e970e469ca`, tree `8029ea02c93d8fc255e4623adfbee7ca458779fe` |
| Versão desta correção | SHA/tree fixados no manifesto externo de handoff depois do commit; cada log identifica sua própria versão |
| Âncora publicada preservada na ancestralidade | `63278f7ef77dd1c4e0db7d9e7219ca48280ee18a`; não reconfirmada por esta frente nesta rodada |
| Ambiente | Local: PGlite descartável em memória. A réplica Supabase é exclusiva do revisor; nenhum serviço, dado ou configuração dela é alterado por esta tarefa |
| Estado | Correção mínima incorporada; regressão local e homologação nativa ainda precisam de evidências do candidato final |
| Ciclo de fixtures | Grafo sintético existente, SQL real de despesa/financeiro, transação com rollback por caso; claims e metadados Storage simulam entradas da plataforma |
| Backend do build local | Origem fictícia `.invalid`, sem chave real; artefato somente de verificação e nunca publicável |

## Hipótese, risco e contrato

O objetivo autorizado é permitir ao motorista autenticado criar e ler a própria despesa operacional, preservando a negação financeira. O forward original não commitado foi preservado, SHA256 `d937851a210ac591d747db24fb0d038f4aaa5f1c92dda06c03830fde81689444`. Ele depende do rollout reconciliado `20260910230055_finance_internal_expense_adjustment_release.sql`, e não apenas do replay histórico de migrations.

O SQL revisado mantém os oito fingerprints, owner, ACLs, volatilidade, search_path, guard de release, locks, autoria da fonte, revisões, comando durável e retry. Somente seis guards externos recebem o caminho operacional; guards financeiros globais, aprovação, pagamento e restrições INSERT/UPDATE/DELETE permanecem. Motorista com papel interno também fica restrito à própria viagem ao criar/repetir.

Dois predicados inseguros foram corrigidos antes de qualquer aplicação: pasta do uploader não prova propriedade da despesa, e `owns_driver(tenant,NULL)` não autoriza uma linha histórica sem motorista. O suplemento revisado `20261001191500_restore_driver_own_operational_expenses.sql` tem SHA256 `7920eba717a1b1682a1dbf3966eefb74ba21e9ce9e7ff0557db3b49346b21f7a`. Leitura Storage exige uma despesa registrada, mesma empresa/caminho e motorista próprio não nulo. Upload/recuperação pendente continua por RPC, sem exceção de SELECT para upload sem despesa.

## Gates e comandos

| Gate | Comando / evidência | Estado |
| --- | --- | --- |
| Coordenação | `node F:/AGVLOG/agvlog.mjs check --task driver-own-expenses-20261005 --owner CodexMerge --cwd F:/AGVLOG/work/driver-own-expenses-20261005` | Obrigatório antes de editar/testar |
| Fonte imutável | Check da tarefa `prepared-updates-20261005` com `--operation test` | SHA/árvore/limpeza exigidos; edição recusada |
| Revisões SQL independentes | Proposta SHA256 `7920...`, revisores `manual_static_review` e `prior_update_reconciliation` | Estática positiva, sem aprovação nativa |
| Regressão SQL em memória | `vitest run src/test/driverOwnOperationalExpensesDatabase.test.ts --maxWorkers 2` | Executa o forward completo, sem remover guards; resultado/log fixado externamente |
| Manifestos | `node scripts/check-baseline-candidate.mjs` | Preservar manifesto original de13 e hashes dos7 suplementos anteriores; acrescentar somente o novo oitavo |
| Código/gate local | Pipeline, release/higiene/qualidade, TS/lints, focused unit, build/bundle/artifact e coordenação | Resultado no SHA da execução; suíte extensiva final pertence ao revisor |
| Réplica nativa | Handoff explícito de SQL/SHA e revisor; Auth/Storage/API/concorrência/jornadas no mesmo candidato | Pendente; nenhuma aplicação executada por esta frente |
| Produção | Paridade atual, backup/retorno, autorização de publicação | Proibida nesta rodada |

## Matriz de fluxos críticos do suplemento

| Critério | Regressão local | Aceite nativo obrigatório |
| --- | --- | --- |
| Própria viagem e despesa | Reproduzir `finance_access_denied`, aplicar SQL completo, criar exatamente uma despesa pending/um comando durável/zero pagamento | Jornada autenticada UI→RPC→persistência no mesmo SHA |
| Retry/revisão/autoria | Mesmo request repete resultado; payload diferente/revisão obsoleta/autoria/empresa/motorista inativo/membership revogada negados | Sessões reais, claims/header e concorrência do banco |
| Fronteira financeira | Motorista e motorista/admin negados em acerto, revisão, pagamento e escrita direta; operador mantém comportamento | Negativas nativas, inclusive replay de acerto depois de virar motorista |
| Comprovantes | Próprio registrado, inclusive uploader operador permitido; alheio na própria pasta, driver nulo e upload sem vínculo negados | Storage upload real, signed URL/list/download e recuperação por RPC |
| Evidência imutável | Falha de auditoria reverte a despesa/comando; metadados incorretos rejeitados; guards/OIDs/ACLs intactos | Falha controlada e locks/concorrência sem bypass de triggers/grants |
| Matriz ampla/manual/frete | Mesma ancestralidade e objetivos anteriores preservados | Todas as18 linhas de `prepared-updates-objectives-acceptance-2026-10-05.md`, sem contar caso mock/skip/provider desligado como aceite |

A negativa local de pagamento executa o writer histórico real sob o guard financeiro reconciliado, com acerto existente e valor positivo. O acerto permanece `pending_review` e a conta default é nula: isso prova rejeição antes da validação de negócio. O revisor ainda precisa negar o writer do catálogo nativo atual com acerto/conta/estado integralmente elegíveis, e conferir ausência de efeitos. Aprovação e ajuste locais usam payloads completos das RPCs reais.

## Estado anterior e plano de retorno

| Camada | Anterior | Candidato | Retorno / limite |
| --- | --- | --- | --- |
| PostgreSQL | Captura/13 forwards/7 suplementos e contrato financeiro reconciliado precisam de confirmação nativa pelo revisor | Acrescentar oitavo suplemento fechado, só no isolado após conferir guard real | Ensaio em réplica descartável: restaurar baseline revisado sob dono exclusivo. Produção futura exige snapshot do catálogo/ACL/policies e compensação nova revisada; trocar frontend não desfaz despesa durável |
| Edge | Gateway atual de receipt usa JWT do chamador e RPC; nenhuma alteração neste suplemento | Mesmo código do candidato unido | Retorno do frontend/Edge só depois de comprovar compatibilidade com despesas/comprovantes criados; nenhum reset ou exclusão da evidência |
| Frontend | Fonte `8673e7a` congelada para revisor | Mesma UI unida mais SQL/testes/manifests/coordenação de congelamento | Homologar mesmo SHA/backend; build local `.invalid` não serve como deploy |

## Decisão e observação

Manter publicação bloqueada até a suíte extensiva e os objetivos antigos/novos passarem no mesmo candidato final. Nenhuma exceção de despesa própria é aceita como pendência de entrega. Regressões conhecidas devem ser corrigidas e reensaiadas. A aprovação de uma versão anterior não se transfere ao novo SHA. Compatibilidade/rollback de produção ainda precisam de autorização e validação próprias.
