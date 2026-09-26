# Log de release — <identificador>

Crie uma cópia deste arquivo para cada release em `docs/qa/release-log-AAAA-MM-DD-<slug>.md`. Registre horários em UTC e links para evidências. Use dados sintéticos ou contagens agregadas; não inclua dados de clientes nem segredos. Consulte o [roteiro de estabilidade](production-stability-playbook-2026-09-26.md). O [incidente de 26/09](production-stability-log-2026-09-26.md) permanece como histórico.

## Identidade e estado

| Campo | Valor |
| --- | --- |
| Responsável pelo release / revisor DB / revisor de fluxos | <nomes ou equipes> |
| Ambiente alvo e projeto Supabase | <staging ou produção, project ref> |
| PR e SHA completo do candidato | <links e SHA> |
| SHA atualmente publicado | <SHA verificado no alias Vercel> |
| Quality gate e release candidate | <links dos runs, status de cada job> |
| Estado | <preparação / bloqueado / staging / promovido / retornado> |

## Estado anterior e plano de retorno

| Camada | Versão anterior verificada | Versão candidata | Retorno preparado |
| --- | --- | --- | --- |
| Postgres | <última versão, contagem e export do ledger; backup/ponto de retorno> | <migrações e ordem> | <compensação SQL revisada; limites> |
| Edge Functions | <nome, versão e hash de cada bundle afetado> | <versões e hash> | <bundle anterior recuperável> |
| Vercel | <deployment imutável, SHA e alias> | <deployment imutável, SHA> | <deployment anterior promovível> |

## Hipótese, risco e contrato

- Defeito ou objetivo: <comportamento observável, ambiente e evidência>.
- Contrato esperado: <RPC/assinatura/grants/RLS, UI e regra de negócio>.
- Risco de regressão: <fluxos e dados afetados, concorrência, limites de tempo>.
- Dependências: <migrações, Edge, frontend; versões já publicadas que devem ser preservadas>.
- Plano de validação e retorno: <critérios mensuráveis e responsável>.

## Gates e comandos

| Gate | Comando / evidência | Resultado e horário UTC |
| --- | --- | --- |
| Revisão local | `git rev-parse HEAD`; diff do PR; `npm run supabase:release:check` | <link/output> |
| Código | `npm run typecheck`; `npm run lint:errors`; `npm run build:check`; testes focados | <link/output> |
| CI completo | `validate`, todos os shards `unit-tests`, `database-and-e2e` | <run e resultado por job> |
| Banco isolado | `supabase db reset --local`; lint, baseline, pgTAP; replay e cenários de concorrência | <link/output> |
| Paridade do alvo | `npm run supabase:parity:check` com `AGVLOG_RELEASE_DB_URL` injetada como segredo | <resultado; bloquear se falhar> |
| Staging | Migrações → contratos → Edge → frontend; `release-candidate.yml`, smoke autenticado | <links e contagens> |
| Produção | Preflight imediatamente antes, publicação ordenada e smoke | <links, horários e contagens> |

## Matriz de fluxos críticos

Marque cada fluxo com `pendente`, `passou` ou `falhou` e vincule teste e smoke do mesmo SHA/ambiente.

| Fluxo | Teste de contrato e interface | Staging | Produção |
| --- | --- | --- | --- |
| Importação CSV/XML | <link/status> | <link/status> | <link/status> |
| Fiscal CT-e/NF-e | <link/status> | <link/status> | <link/status> |
| Financeiro | <link/status> | <link/status> | <link/status> |
| Portal | <link/status> | <link/status> | <link/status> |
| Estoque e operação | <link/status> | <link/status> | <link/status> |
| Equipe e incidentes | <link/status> | <link/status> | <link/status> |
| SSX, endereços e rastreamento | <link/status> | <link/status> | <link/status> |

## Linha do tempo (UTC)

| Horário | Ação, versão e responsável | Evidência | Resultado |
| --- | --- | --- | --- |
| <AAAA-MM-DD HH:MM> | <preflight / migração / Edge / Vercel / smoke / observação / retorno> | <link ou artefato> | <passou / falhou / pendente> |

## Decisão e observação

- Decisão: <liberar / manter bloqueado / retornar>, por <responsável>, às <UTC>.
- Pendências aceitas e prazo: <nenhuma ou descrição com responsável>.
- Gatilhos de retorno: <erros e limites observáveis>.
- Resultado da janela de observação: <métricas, falhas, fluxos, horário UTC>.
- Estado final de Postgres, Edge, Vercel e Git: <versões verificadas>.
