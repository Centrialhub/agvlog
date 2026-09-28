# Log de implantação — homologação local, 28/09/2026

## Identidade e estado

| Campo | Valor |
| --- | --- |
| Objetivo | Ambiente local isolado compatível com Supabase, posteriormente transportável para servidor interno |
| Autorização | Responsável confirmou: “vamos seguir com essa alternativa” |
| Alvo | Computador local; projeto `agvlog-local-staging`, ativo no Ubuntu-24.04/WSL 2 |
| Checkout | Worktree `production-stability`, branch `codex/production-stability`, PR #3 |
| Base desta etapa | Preparador criado sobre `31731e2c7d57d33d0f83b157f13353fcaa53ed69`; primeira partida Linux no candidato `4044c23d85da464f6f5678f1c9c149cb827813fb` |
| Estado | Infraestrutura vazia iniciada e verificada; baseline autoritativo pendente; `applicationReady=false` |
| Publicação | Nenhuma alteração de banco, Edge ou frontend de produção nesta etapa |
| Responsáveis | Implementação: agente desta conversa; instalação administrativa: responsável do computador; revisão de baseline: responsável pelo banco a definir |

## Decisão e contrato

Usar Docker Engine em Linux/WSL 2 e a CLI 2.116.0 já fixada, com configuração própria, portas distintas e dados sintéticos. A instalação inicial fica sem migrações, seed, hook e Edge do aplicativo. O guia permanente é [local-staging-guide.md](local-staging-guide.md).

O erro histórico em `20260830061800` permanece. O run anterior [36277638858](https://github.com/Centrialhub/agvlog/actions/runs/36277638858), SHA `31731e2c`, teve validate e oito shards aprovados; banco/E2E falhou em 26/09 às 22:56:24 UTC com `Idempotency membership helper changed`. Este preparo não corrige nem aprova esse gate.

## Evidências iniciais, antes da instalação

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
| Gerador/configuração e testes de proteção | Arquivos gerados; verificação passou; 30/30 testes após revisão dos metadados reais e diretório Studio |
| WSL 2 e distribuição Linux | Concluído após reinício; Ubuntu 24.04.5, WSL 2.7.13.0 |
| Docker Engine e binding loopback | Engine 29.8.1; rede e portas efetivas em 127.0.0.1, inclusive no Windows |
| Stack vazia iniciada e health checks | 9 serviços ativos; PostgreSQL 17.6; Auth, REST e Studio HTTP 200 |
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

## Continuação após o reinício — 12:23 a 12:47 UTC

O responsável informou “PC reiniciado”. O boot foi registrado em **12:20:36 UTC** e a verificação não encontrou reinício pendente. `wsl --install --distribution Ubuntu-24.04 --no-launch` concluiu com código 0; a distribuição iniciou realmente como WSL 2, Ubuntu 24.04.5 `noble/amd64`, kernel `6.18.33.2-microsoft-standard-WSL2`, com systemd no PID 1.

O [provisionador Linux](local-staging-linux-runtime.md) passou em `bash -n`, revisão e execução (código 0), instalando Docker 29.8.1, containerd 2.3.6, Buildx 0.37.1, Compose 5.5.1, Node 22.23.2 e npm 10.9.4. Criou `agvqa` sem senha; o acesso ao grupo Docker foi concedido separadamente. O daemon usa socket Unix, sem endpoint TCP configurado.

### Identidade do código e dependências

- Checkout Linux: `/home/agvqa/agvlog-main`, branch `codex/production-stability`, limpo no SHA **4044c23d85da464f6f5678f1c9c149cb827813fb** na primeira partida.
- Transferência: bundle Git completo de 16.162.811 bytes; SHA-256 **ab97e791606a97092f925e43fe3561eed6e338e1871a8bc722ff6907efc90467**. O `origin` Linux aponta a esse arquivo, sem credenciais GitHub copiadas.
- Dependências próprias no Linux: `npm ci` concluiu com código 0, 620 pacotes instalados/621 auditados, zero vulnerabilidades informadas. CLI **2.116.0** conferida.
- Nenhum `.env`, segredo, dado de cliente, seed ou histórico de migrações foi transferido para o workdir `.local-staging`.

### Partida e verificações

A rede `agvlog-local-staging-loopback` foi criada em bridge/NAT com `com.docker.network.bridge.host_binding_ipv4=127.0.0.1`. A partida com `supabase start --workdir .local-staging --network-id agvlog-local-staging-loopback` concluiu com código 0. O output privado ficou em `/home/agvqa/.local/state/agvlog-staging/start-2026-09-28.log`, diretório 0700 e arquivo 0600; não versionar nem publicar seu conteúdo, pois a CLI exibe chaves locais.

O encerramento do último cliente WSL causava parada da distribuição e nova partida dos serviços na próxima inspeção. Foi mantida uma sessão WSL oculta específica para essa distribuição/usuário, sem alterar `.wslconfig` ou iniciar serviço global. Registro local: PID 7068, criação **12:40:41.1266702 UTC**; revalidar identidade antes de qualquer encerramento, pois PIDs são reutilizáveis. O ciclo de vida e seus limites estão no [procedimento Linux](local-staging-linux-runtime.md#ciclo-de-vida-no-windows).

O [JSON sanitizado capturado em 12:41:03 UTC](local-staging-runtime-evidence-2026-09-28.json) registra imagens e IDs dos nove containers, saúde, portas e probes. Resultado:

| Verificação | Resultado observado |
| --- | --- |
| Containers do projeto | 9 em execução; 8 `healthy`; REST sem healthcheck de container, mas HTTP 200 |
| PostgreSQL | 17.6; **zero tabelas públicas de aplicação** |
| Auth `/auth/v1/health` | HTTP 200 com chave pública local mantida apenas em memória |
| REST `/rest/v1/` | HTTP 200 |
| Studio | HTTP 200 no Linux e no Windows |
| Caixa de e-mail local | HTTP 200 pelo Windows |
| TCP banco pelo Windows | Porta 55322 acessível |
| Portas 55321–55324 | Bindings dos containers e listeners Windows em **127.0.0.1** |
| Continuidade após período ocioso | Nove serviços ativos na conferência seguinte; DB iniciou 12:40:42.596558 UTC e `restartCount=0` |

### Proteções adicionadas após a execução real

A CLI criou `.temp/cli-latest` (`v2.118.0`) e `.branches/_current_branch` (`main`) além dos arquivos preparados. O verificador anterior os recusava por sua lista fechada. A revisão admite apenas esses dois tipos de metadados locais, validando formato, tamanho, tipo e ausência de links, preservando bytes/mtime. Na conferência após transferir `ee062fd3`, o runtime também tinha criado `supabase/snippets` vazio, usado pelo Studio; essa execução bloqueou corretamente o artefato ainda desconhecido. A compatibilidade foi ampliada somente para esse diretório vazio, mantendo a rejeição de qualquer conteúdo ou link. `project-ref` remoto, SQL, `.env` e artefatos desconhecidos continuam proibidos; a versão disponível em cache não muda a CLI 2.116.0 fixada.

O comando `staging:local:health` passa a verificar o runtime de forma reproduzível, sem emitir credenciais. É exclusivo desta fase vazia: deve falhar se tabelas públicas já estiverem restauradas. Não serve como aprovação de login da aplicação, RLS de negócio, importação, fiscal ou financeiro.

O preparador revisado passou em **23/23 testes**. O pipeline de contratos de scripts passou em **65/65**, sem falhas ou casos ignorados, usando Node **22.23.2** e npm **10.9.4**. ESLint focado, sintaxe Node, contrato do lockfile e conferência de whitespace passaram. O provisionador mantém o hash registrado acima. São evidências das ferramentas de preparação; os testes da aplicação continuam pendentes do baseline.

Após admitir o diretório vazio do Studio, o preparador passou em **30/30** e o pipeline completo em **72/72**, com as mesmas versões de Node/npm, sem falhas ou casos ignorados. A inspeção dos mounts confirmou que `supabase/snippets` é o único bind do container Studio. Não foi admitido conteúdo SQL nessa pasta.

### Gate remoto e impedimento restante

O [Quality gate run 132](https://github.com/Centrialhub/agvlog/actions/runs/36420533842), do SHA **4044c23d85da464f6f5678f1c9c149cb827813fb**, terminou com `validate` e oito shards unitários aprovados. `database-and-e2e` falhou em **12:19:20.8560327 UTC**, ao reproduzir a migração `20260830061800`: `Idempotency membership helper changed (SQLSTATE P0001)`. Esse replay histórico continua inválido. A instalação local não corrige seu resultado.

O próximo gate depende da **estrutura autoritativa do banco**, por conexão PostgreSQL protegida ou arquivo de esquema revisado. `AGVLOG_RELEASE_DB_URL` permanece ausente; o conector disponível não fornece exportação restaurável equivalente ao dump. Foi solicitada a fonte ao responsável, sem senha no chat. Até recebê-la: baseline não restaurado, 13 forwards não aplicados, Auth hook/Edge/seed da aplicação desativados, integrações externas não configuradas e testes funcionais pendentes. A homologação e a versão estável permanecem sem aprovação.

## Verificação final da infraestrutura e proteção adicional — após 12:58 UTC

O comando versionado `npm run staging:local:health` passou em **12:58:17.560 UTC**, no checkout Linux limpo, SHA **bced0aa418f7c4c07a0258ca6253a270caac88b4**. Nove serviços, oito health checks e REST validado por HTTP; Auth/REST/Studio/mail HTTP 200, PostgreSQL 17.6 e zero tabelas públicas. O Studio redirecionou uma vez dentro da mesma origem local. O verificador usa `index` ao inspecionar a saúde Docker porque REST não possui a chave `State.Health`; a tentativa anterior bloqueou essa ausência antes da correção e do novo ensaio real. Verificador SHA-256 `b81db7de54b604d93795a382de496203565b6e17d5db516e7ef301c549ef75d8`; relatório sanitizado local `runtime-bced0aa4.json`, SHA-256 `b20e31b1a464ea7024de48ef7b0164873364db90b976e98247d530a2fde8f5ec`.

A revisão seguinte identificou sobreposição possível no workflow hospedado: o grupo de concorrência incluía `candidate_sha`, embora candidatos diferentes usem o mesmo `STAGING_SUPABASE_URL`. O grupo foi alterado para `release-candidate-staging`, mantendo `cancel-in-progress: false`. A configuração limita a uma execução ativa que use esse grupo no repositório. O [guia do workflow](release-candidate-environment-guard.md#concorrência-e-isolamento-dos-dados-de-teste) explica a substituição de execuções pendentes e os limites do controle.

O YAML foi carregado e revisado; **10/10 testes existentes** de URL, ambiente protegido e backend passaram em Node 22.23.2; `git diff --check` passou. Nenhum workflow hospedado foi disparado para ensaiar a concorrência: o ambiente protegido e o banco funcional continuam pendentes. A regra só se torna política efetiva do fluxo confiável após incorporar o workflow à branch principal. Ela não resolve resíduos entre workers, retries ou jornadas sucessivas, nem impede outras ferramentas de usar o banco. O isolamento completo da jornada depende da conferência dos contratos e fixtures no baseline restaurado.

O [Quality gate run 133](https://github.com/Centrialhub/agvlog/actions/runs/36425340071), SHA **bced0aa418f7c4c07a0258ca6253a270caac88b4**, terminou com `validate` e os oito shards aprovados. O [job de banco/E2E](https://github.com/Centrialhub/agvlog/actions/runs/36425340071/job/108938852007) falhou em **13:03:37.8119129 UTC**, na migração `20260830061800`, com `Idempotency membership helper changed (SQLSTATE P0001)` e saída 1. Confirma o bloqueio do replay histórico; reset, lint do banco, pgTAP e E2E não executaram. Nenhuma migração histórica foi alterada para contornar a falha. A correção de concorrência descrita acima não muda esse replay e requer seu próprio SHA/gate antes de promover.
