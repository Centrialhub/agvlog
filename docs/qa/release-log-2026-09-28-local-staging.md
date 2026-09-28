# Log de implantação — homologação local, 28/09/2026

## Identidade e estado

| Campo | Valor |
| --- | --- |
| Objetivo | Ambiente local isolado compatível com Supabase, posteriormente transportável para servidor interno |
| Autorização | Responsável confirmou: “vamos seguir com essa alternativa” |
| Alvo | Computador local; projeto planejado `agvlog-local-staging` |
| Checkout | Worktree `production-stability`, branch `codex/production-stability`, PR #3 |
| Base desta etapa | `31731e2c7d57d33d0f83b157f13353fcaa53ed69`; novas alterações de infraestrutura devem ser registradas no próximo commit |
| Estado | Preparação; WSL instalado e componente Windows ativado, aguardando reinício; baseline autoritativo pendente |
| Publicação | Nenhuma alteração de banco, Edge ou frontend de produção nesta etapa |
| Responsáveis | Implementação: agente desta conversa; instalação administrativa: responsável do computador; revisão de baseline: responsável pelo banco a definir |

## Decisão e contrato

Usar Docker Engine em Linux/WSL 2 e a CLI 2.116.0 já fixada, com configuração própria, portas distintas e dados sintéticos. A instalação inicial fica sem migrações, seed, hook e Edge do aplicativo. O guia permanente é [local-staging-guide.md](local-staging-guide.md).

O erro histórico em `20260830061800` permanece. O run anterior [36277638858](https://github.com/Centrialhub/agvlog/actions/runs/36277638858), SHA `31731e2c`, teve validate e oito shards aprovados; banco/E2E falhou em 26/09 às 22:56:24 UTC com `Idempotency membership helper changed`. Este preparo não corrige nem aprova esse gate.

## Evidências desta etapa

| Verificação | Resultado |
| --- | --- |
| Host | Windows 11 Pro, versão 10.0.26200, RAM total 31,9 GB, virtualização habilitada |
| Espaço livre observado | C: aproximadamente 1.176 GB; F: aproximadamente 372 GB |
| Docker | Comando ausente do PATH; Docker Desktop ausente do caminho padrão; nenhum daemon validado |
| WSL | `wsl --status` e `wsl --list --verbose` informaram não instalado |
| Privilégios da sessão | Token sem privilégio de administrador |
| Fonte do esquema | `AGVLOG_RELEASE_DB_URL` ausente; não encontrado dump restaurável atual nos artefatos revisados |
| CLI | `node node_modules/supabase/dist/supabase.js --version`: 2.116.0; help de start/stop/status conferido |
| Forwards | `node scripts/check-baseline-candidate.mjs`: 13 arquivos conferidos pelo revisor nesta etapa |

## Instalação tentada e bloqueio

Em 28/09, antes de 12:03 UTC, `wsl --install --no-distribution` retornou código 1, informando WSL ausente. Foi então consultado o pacote Microsoft.WSL no repositório winget: versão 2.7.13, Microsoft, MSIX, checksum SHA-256 `3c481b5739a988b22cb81f21737d0f496473ee69bffb1885cc52a77a02ce9fa2`.

A tentativa `winget install --id Microsoft.WSL --exact --version 2.7.13 --source winget --silent --accept-source-agreements --accept-package-agreements --disable-interactivity` verificou o hash do instalador e falhou com **0x80073d28**, exigindo privilégios administrativos. A instalação não foi considerada concluída. Não houve reinicialização.

Foi solicitado ao responsável executar a instalação em PowerShell como administrador. Essa intervenção decorre de uma restrição real do Windows, não de necessidade de contratar infraestrutura em nuvem.

## Limites e próximos gates

| Gate | Estado |
| --- | --- |
| Gerador/configuração e testes de proteção | Arquivos gerados; verificação passou; 12/12 testes de proteção passaram |
| WSL 2 e distribuição Linux | WSL 2.7.13 instalado; componente Windows ativado com reinício pendente; distribuição ainda ausente |
| Docker Engine e binding loopback | Pendente |
| Stack vazia iniciada e health checks | Não executado |
| Dump revisado, complementos e comparação de catálogo | Pendente de fonte autoritativa |
| Forwards, hook, seed e Edge | Não aplicados |
| Importação/fiscal/financeiro e demais fluxos | Não executados neste ambiente |
| Quality gate completo e retorno ensaiado | Pendentes |

O retorno desta etapa consiste em parar apenas os containers do identificador local, preservando volumes. Não há SQL de produção a reverter. A retirada de dados/volumes locais só será necessária após implantação e deverá identificar exatamente os recursos descartáveis.

## Validação dos arquivos preparados

Em 28/09, após 12:03 UTC, `npm run staging:local:prepare` gerou o workdir isolado e `npm run staging:local:check` passou. Ambos informaram `applicationReady=false` e que nenhum serviço foi iniciado. `git check-ignore` confirmou a exclusão de config e manifesto gerados. O template revisado usa SHA-256 LF `df0703b59d0ecac3d5ef7fd98a3cc20c878a861afc7f84cee349a7ff01b7a021`.

`node --test scripts/prepare-local-staging.test.mjs` passou em **12/12**, cobrindo isolamento do destino, repetição sem sobrescrita, arquivo alterado, links/junctions, contaminação por ambiente/vínculo/migração, baseline inventado, hash do template, versão CLI e manifesto falsificado. ESLint focado, contrato do lockfile e `git diff --check` passaram. Esses testes verificam o preparador; não exercitam containers, banco, login ou fluxos da aplicação.

A revisão da fonte CLI confirmou suporte a uma rede bridge pré-criada com binding loopback. O guia inclui a sequência e a conferência das portas efetivas, pendentes de execução. Instalação administrativa e captura do esquema continuam sendo os próximos passos necessários.

O pipeline Node completo passou em **54/54 testes** após a integração dos 12 novos casos. A CLI 2.116.0 foi exercitada com `status --workdir` em diretório temporário separado: o TOML válido chegou à inspeção do Docker e retornou `LegacyStatusDbInspectError` por runtime ausente; TOML malformado retornou `LegacyStatusConfigLoadError/CliConfigParseError`. Isso comprova leitura/sintaxe do arquivo, não validação completa das opções nem funcionamento da stack. Nenhum `start` foi executado.

Às 12:09 UTC, a execução com as versões do projeto (`npm exec --yes --package=node@22.23.2 --package=npm@10.9.4 -- npm run test:pipeline`) também havia concluído **54/54**, sem falhas nem casos ignorados. O verificador de higiene passou para 4.593 arquivos no índice, e o diff preparado passou na conferência de whitespace. O Quality gate remoto não foi repetido por esta preparação; permanece necessária uma execução completa após disponibilizar o baseline válido.

## Continuação após a instalação administrativa — 12:12 UTC

O responsável informou a instalação concluída. `wsl --version` confirmou **2.7.13.0**, kernel **6.18.33.2-2**, com WSL 2 como padrão; `wsl --list --verbose` confirmou ausência de distribuições. `wsl --status` ainda informou indisponibilidade da virtualização do Windows e recomendou habilitar a Plataforma da Máquina Virtual.

Foi executado `wsl --install --no-distribution`. O comando retornou **código 0** e sucesso, informando que as alterações só terão efeito após reinicializar o sistema. O agente não reiniciou o computador. `wsl --list --online` confirmou disponibilidade de **Ubuntu-24.04**.

Próxima retomada: após o reinício feito pelo usuário, conferir `wsl --status`, instalar Ubuntu-24.04 com `--no-launch`, validar a inicialização real de WSL 2 e prosseguir com Docker. Não há motivo confirmado para alterar a BIOS: a inspeção anterior indicou virtualização de firmware habilitada. Banco, Docker e aplicação continuam sem inicialização nesta etapa.
