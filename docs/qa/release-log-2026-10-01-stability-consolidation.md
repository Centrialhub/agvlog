# Log de release — consolidação local de estabilidade, 01/10/2026

## Identidade e estado

| Campo | Valor |
| --- | --- |
| Responsável / revisão | Execução local Codex; decisões de contrato/segurança e promoção com Thomaz/owners |
| Estado | **Bloqueado para publicação**; preservação e consolidação local executadas |
| Branch | codex/stability-integrated-20261001; caminhos exatos no [mapa de checkouts](checkouts-2026-10-01.md) |
| Base | main a0c9771cf7db2d6a65819a2252cd8fb2344dd869 + PR3 0660cbd70ccb961e5e78cb446f1e8941c25eb01b; merge 3c476eb1e18f1936199afe123919cdcf65d66aa8 |
| Alvo local | agvlog-local-staging, loopback 55321/55322, sem vínculo remoto |
| Último candidato com navegador completo | 272bf010264bf484ad16137c45bf612bd023e023, buildHash e11231e710411b7f |
| Nova validação independente | Commit que contém este log, patches transitivos e teste de segurança; SHA/tempos/contagens finais gerados em `.execution-logs/final-independent-evidence.json`, sem auto-referência de SHA no commit |
| Estado publicado | Pesquisa remota separada; referência informada a0c9771 e READY em 29/09 não comprovam estabilidade operacional nem paridade SQL/Edge |
| Fixtures | 7 contas `.invalid`, 2 tenants,327tabelas/todasRLS, oito buckets; cron/Vault/HTTPqueue/integrations externos desativados; um worker, histórico/evidências vinculadas preservados |
| Janela produtiva | Não iniciada; nenhum push,merge remoto,deploy ou SQL produtivo nesta execução |

## Estado anterior e retorno

| Camada | Anterior verificado localmente | Candidato / retorno e limite |
| --- | --- | --- |
| Postgres | Baseline revisado pin501f7c02e647c5c4e6e69267812067cb0a184524f44f9db2a4e5b1853152a649 | 13 forwards + 7 suplementos; ensaio independente com 175 pgTAP; retorno inteiro ao dump pré-upgrade e re-upgrade passaram. Não é retorno sem perda após escritas produtivas |
| Edge | Fontes históricas recuperadas e hashes versionados nos manifestos | Syntax 98/98; 13 testes de retry/rollback; leitor de retorno preserva rate_limited/cooldown/429. Transporte simulado; nenhum provedor ou deploy executado |
| Frontend | Main informado a0c9771 com hotfixes PR4/PR5 preservados | Artefato local vinculado aSHA/origem; PWA,aria e Escape corrigidos; nenhuma promoção Vercel |
| Billing | Pacote legado preservado em checkout novo | Branch separado clean de45d927f79aa03e43d0b89266b059f30a3a5361; 46 testes separados; migration 20260929202823 não integrada/aplicada |

Ensaio limpo: projeto `agvlog-pristine-restore-20261001`, rede/portas 56320-56329
separadas. Dump pré-upgrade SHA256
`62ee7b260538a2addf4f4f6ad1534d3e15fbf544eb1941305b47899772b23ee4`.
Retorno concluído às 14:08:32.202 UTC, mantendo 327 tabelas/todas com RLS/oito buckets e zero
usuários/objetos. Restore preservou ownership/ACL; somente ensure_rls foi criado
como owner postgres após os demais objetos como supabase_admin. Novo upgrade no 1b487266
às 14:19:40.933 UTC passou 175/175. SQL hash
`f405738829bde9a3ae19bbc7003ad54e3b105f7c16e7f63e36265b523cdf5c76`.

## Contrato e regressões

| Ocorrência | Causa confirmada / correção | Evidência / limite |
| --- | --- | --- |
| Múltiplas árvores confundem agentes | 22 checkouts preservados, 65 refs/22 HEADs; canonical novo escolhido | Legados intactos; cópia limpa pode conter commit exclusivo; nenhuma exclusão |
| CI limite de linhas | Extração de draft CTe e decodificação ORT | Sem aumento de limites; comportamento e testes preservados |
| PWA não registra worker | Evento load podia ocorrer antes do import assíncrono terminar | Corrigida inscrição quando readyState complete; testes/PWA local |
| Portal link sem nome | Link de ícone precisava de nome acessível | Href/dados preservados; axe continua obrigatório |
| Escape perde diálogo financeiro | Radix captura Escape antes do bubbling do seletor | Teste com diálogo real falhou antes/passou depois; prevenção restrita ao picker, draft/foco preservados; Escape externo continua fechando |
| Axe operador/responsivo | Captura durante entrada e região de tabela sem foco | Espera conteúdo/layout/animações finitas e Table scrollLabel em RecordedCosts; regras/thresholds não mudaram |
| Retry cargas | Fixture procurada fora da primeira página (50 itens) | Intercepta RPC atual, exige recuperação real e filtra carga específica; erro/falso-vazio continuam testados |
| Partida motorista | Fixture ignorava custódia/checklist | RPCs reais, conferência paginada e 2 PNGs físicos recebidos/enviados permitem saída/início/chegada; evidência vinculada fica no staging descartável |
| Gastos motorista, 4 E2E | UI operacional chama APIs deliberadamente negadas por fronteira financeira/RLS | FinanceLegacyRpcBoundary exige negação; formulário mocka contexto permitido. Decisão pendente de escopo. Nenhum grant/guard/assertion mudou |
| Advisories transitivos | brace-expansion recursão e DOMPurify detached hooks | Apenas quatro entradas de lock; versões 1.1.21/2.1.7/3.4.16. Antes: 5 FAIL/2 PASS; depois: 7 PASS; npm ci e audit (zero vulnerabilidades) passaram |

DOMPurify é transitivo via jsPDF; busca do código executável não encontrou uso
direto, IN_PLACE ou hooks próprios. jsPDF sanitiza string no modo comum. A prova
usa árvore DOM sintética com hook para reproduzir o advisory e não comprova uma
exploração do AGVLOG. Patch conserva sanitização comum e formatação. Fontes:
[brace recursão](https://github.com/advisories/GHSA-qhr7-859c-m2p7),
[brace complexidade](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr),
[DOMPurify](https://github.com/advisories/GHSA-p98j-92pf-mc4p).

## Gates e evidências concluídas por SHA

| Gate | Resultado comprovado |
| --- | --- |
| Unitário completo 6d4180a3 | 7.390 PASS/1 SKIP, 1.333 arquivos PASS + 1 SKIP; resultado histórico, não atribuído ao candidato posterior |
| Native/pristine 1b487266 | 175/175 contratos SQL, upgrade/retorno/re-upgrade independente |
| Focados f7639301 | 54 testes/14 arquivos PASS; types, lint, quality 99/113/nenhum arquivo novo >500 linhas PASS |
| Pipeline 272bf010 | 180/180 PASS; 17 testes driver/security/form em 5 arquivos PASS; YAML/bash do workflow válidos |
| Coverage 272bf010 | 87.81% statements, 74.78% branches, 93.93% functions, 91.35% lines; thresholds CI PASS |
| Browser 272bf010 | 74 PASS/4 FAIL/18 SKIP; critical 3x: 105 PASS/0 FAIL/12 SKIP; log 16:33:50.618 UTC; senhas restauradas |
| Benchmark opt-in 272bf010 | 1 PASS; 10 mil títulos/20 amostras; PGlite apenas, sem meta de latência produtiva |
| Dependências após patch | npm10.9.4/Node22.23.2; npm ci congelado; zero vulnerabilidades; 7 regressões reais PASS |
| SQL lint atual | 31 erros/exit 1, sem exclusão; [triagem por função](local-database-lint-triage-2026-10-01.md) |
| CI hospedado | Não executado; [entrega privada ainda não autorizada/configurada](ci-private-baseline-handoff-2026-10-01.md) |
| Paridade/publicação | Não executadas; versões reais atuais dependem da pesquisa remota e preflight autorizado |

O comando unitário final habilita `FINANCE_PORTFOLIO_BENCHMARK=1` para executar
também o único skip opt-in histórico. Não se remove uma assertion para obter
verde. O registro JSON final associa SHA, comandos, exit e horários e hashes dos logs;
é produzido depois deste commit para evitar inventar resultado antes da execução.

## Matriz de fluxos

| Fluxo | Local / limite | Produção |
| --- | --- | --- |
| Importação CSV/XML/ORT | Contratos unitários/erro ORT aprovados; integração ORT sandbox pendente | Não homologada |
| Fiscal CTe/NFe/NFSe | Hotfixes PR4/PR5 preservados; RPC autenticada local; sem emissão real | Provedor fiscal/sandbox pendente |
| Financeiro interno | Regressões/keyboard/receipts existem; nenhuma função nova neste patch | Fluxos reais e estado obsoleto/concorrência ainda exigem homologação |
| Motorista | Custódia/partida/arrival passam; 4 cenários bloqueados por contrato de gastos | Estado produtivo atual não inferido |
| Portal/Auth/tenant | Claims assinados, IDOR e readers locais; Storage A recebe bytes,B/anônimo negados; objeto solto limpo | Smoke do mesmo deployment ainda necessário |
| Equipe/operacional | Readers e rotas responsivas; mutations auditadas locais | Jornada operacional real pendente |
| SSX/endereço/rastreamento | Bundles/retorno recuperáveis;transportes simulados | Provedor e Edge ativos não homologados |

Full: 18 skips = 9 testes exclusivos de desktop × 2 outros viewports: 3 registries, piloto
keyboard,readiness financeira,fiscal RPC, 2 mutations auditadas, Storage. Critical: 12
= fiscal + Storage × 2 viewports × 3 repetições. Published-finance-verification não compõe
os 96 casos locais, pois exige credenciais live e cria centro de custo; permanece
lacuna externa, não se soma aos 18 skips. @critical aprovado não libera full.

## Decisão e próximos passos autorizáveis

Manter bloqueado. Concluir checks independentes no SHA deste log, preservar billing
separado, gate SQL bruto e quatro E2E de gastos. Owner decide contrato operacional do
motorista; owners de serviço fornecem inventário sanitizado das 21 APIs retidas.
Não presumir autorização pelo tempo decorrido. Nenhum grant/policy/retirada de fluxo
ou enfraquecimento de assertion é solução implícita para esses bloqueios.

Após gates e homologação: revisar SHA/bundles/paridade imediatamente antes;
aprovar transferência privada/CI e publicação concretamente; promover SQL,
contratos, Edge, frontend em ordem. Registrar versões e observação operacional
acordada. Gatilhos de retorno incluem violação tenant/role, duplicação fiscal ou
financeira, perda de evidência, aumento sustentado de falhas e checkpoint/cooldown
incompatível. Retorno produtivo requer plano para escritas novas; restaurar apenas
frontend não desfaz esquema/dados. Este log registra execução local, não release
publicado nem risco zero.
