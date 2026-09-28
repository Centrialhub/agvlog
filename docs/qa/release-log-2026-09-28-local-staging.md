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

## Captura da fonte autoritativa — 17:28 a 17:38 UTC

O [run 134](https://github.com/Centrialhub/agvlog/actions/runs/36426241446), SHA **813578468d3bca957d61f1da1ce1681088b46cb9**, terminou com `validate` e oito shards aprovados. O [job de banco/E2E](https://github.com/Centrialhub/agvlog/actions/runs/36426241446/job/108941726798) falhou em **13:10:28.2191951 UTC** na mesma migração histórica, com o mesmo erro e saída 1. O restante do gate de banco/E2E não executou.

Após o pedido de usar a skill **Supabase**, foi reavaliada a hipótese de acesso bloqueado. A CLI 2.116.0 já tinha autenticação válida e acesso ao projeto; sua credencial temporária oficial, combinada ao acesso PostgreSQL IPv6 pelo Windows, permitiu a captura. Isso corrige a conclusão anterior de que seria necessário receber uma DSN permanente ou dump do responsável. Não foi criada branch Supabase Cloud.

A [evidência da captura](authoritative-schema-capture-2026-09-28.md) registra procedimento, horários, versões, proteção e hashes. O esquema de 7.452.972 bytes preserva owners e ACLs e não contém linhas de clientes. Papéis foram exportados sem senhas e o ledger apenas com `version`/`name`. O catálogo antes/depois coincidiu nas 18 categorias; a coleta posterior dos hashes por objeto, entre 17:37 e 17:38 UTC, recompôs os mesmos 18 resultados. O corte permaneceu em 896 migrações, última `20260924155758`.

O dump bruto permanece privado. A revisão separa as 13 áreas de esquema da aplicação, customizações em Auth/Storage, publicações e diferenças da plataforma. O dump integral não será usado para sobrescrever os componentes gerenciados locais. O ledger de produção permanece como referência externa de captura; não serão inseridas 896 linhas no ledger local como se tivessem sido executadas.

**Estado desta etapa: fonte capturada, revisão e montagem em andamento; baseline ainda não restaurado.** Os 13 forwards, seed, Auth hook, Edge e testes funcionais continuam pendentes. Não houve publicação das correções candidatas nem alteração do esquema da aplicação em produção.

### Preparador de baseline revisado

Foi implementada uma transição explícita para copiar artefatos aprovados, por manifesto privado e hash externo, sem executar SQL. O [guia](local-staging-guide.md#preparação-explícita-dos-artefatos-revisados) descreve a interface e seus limites. São preservados o TOML, o modo vazio e a lista fechada de arquivos; os forwards são conferidos contra o manifesto versionado. O verificador do runtime ainda exige zero tabelas públicas, mesmo nessa etapa de arquivos preparados.

A revisão encontrou e corrigiu, antes de qualquer execução, uma incompatibilidade no rascunho SQL: três privilégios padrão de `supabase_admin` não podem ser restaurados sob `SET ROLE postgres`. Esses blocos foram deslocados, sem alterar seu SQL, para o complemento de plataforma executado com o papel local adequado. As definições da aplicação permaneceram iguais ao dump.

Testes: **50/50** focados no preparo/baseline e **92/92** no pipeline completo, sem falhas nem casos ignorados. O pipeline foi executado com Node **22.23.2** e npm **10.9.4**. ESLint focado, sintaxe e whitespace passaram. Esses resultados aprovam as proteções de preparo; a restauração e os fluxos da aplicação ainda não foram testados por eles.

### Primeiro ensaio transacional — 17:49 UTC

Os artefatos foram preparados no Linux no commit **0fde19fa7e0cf9b940d950a7359d85e44ec8c251**, com verificação real dos arquivos, nove serviços e zero tabelas públicas. O [registro da revisão e do ensaio](local-baseline-review-2026-09-28.md) detalha a composição, os limites e as diferenças de plataforma.

A restauração em uma transação foi interrompida na criação de `ensure_rls` sob um papel diferente do owner da função. O erro provocou rollback; o banco permaneceu sem tabelas públicas. Às **17:51:03 UTC**, uma sondagem também revertida confirmou a correção: criar esse gatilho sob `postgres`. Não houve aplicação dos forwards nem seed.

O procedimento passou a admitir revisões imutáveis dos artefatos, com hash anterior e novo explícitos, preservando o SQL e o manifesto anteriores. Essa proteção registra as tentativas sem sobrescrever a evidência e continua sem afirmar que o banco foi restaurado.

Após essa alteração, passaram **58/58 testes focados** e **100/100 no pipeline completo**, novamente com Node 22.23.2 e npm 10.9.4. A revisão do verificador de catálogo identificou truncamento de chaves longas pelo tipo PostgreSQL `name`; a consulta foi corrigida para `text`. A [revisão do baseline](local-baseline-review-2026-09-28.md#correção-da-consulta-de-comparação) explica a limitação dos hashes anteriores e a necessidade da captura corrigida em ambos os ambientes.

### Baseline restaurado — 18:01 UTC

O segundo ensaio concluiu com sucesso entre **18:01:20.365 e 18:01:25.934 UTC**, no checkout Linux limpo **4850412c19bec6cc4134fb48e1f9e3b4c1ee65fd**. A [evidência sanitizada](local-baseline-restore-evidence-2026-09-28.json) registra aprovação, hash do SQL combinado, identidade do container e contagens. Resultado: **327 tabelas públicas, todas com RLS; oito buckets; zero jobs de cron, segredos Vault ou itens na fila HTTP**. Forwards aplicados: **zero**.

A recaptura de produção com chaves `text` foi conferida em **18:08:11.594 UTC**: 18 categorias, 20.728 objetos, zero colisões; as listas por objeto recompõem exatamente os agregados anterior (17:58:15.692) e posterior (18:07:35.171). O corte permaneceu em 896 migrações, máximo `20260924155758`.

A comparação local de **18:06:41.369 UTC** usa a mesma consulta e exclui somente o ledger histórico, preservado como referência externa. Coincidem integralmente: **1.678 rotinas, 1.336 políticas, 816 tipos, 14 definições de views, seis privilégios padrão, seis sequências e oito buckets**. A comparação inclui owners e ACLs nas categorias correspondentes. Diferenças em relações/permissões, posições de colunas, constraints e componentes gerenciados estão sendo classificadas por objeto. Não equivalem automaticamente a defeito nem podem ser ignoradas como equivalentes sem investigação. **Baseline restaurado, comparação ainda não aprovada; aplicação não homologada.**

### Comparação aprovada para o ensaio e 13 forwards aplicados — 18:18 UTC

O [parecer por objeto](local-baseline-comparison-2026-09-28.md) concluiu a classificação: 85 ACLs equivalentes, 28 colunas ativas de geofences equivalentes, oito CHECKs estruturalmente equivalentes, catálogo da aplicação preservado no escopo capturado. Os nove metadados de locale/encoding/provider/versão coincidiram na fonte e no local; última captura local anterior aos forwards às **18:17:55.796 UTC**. Limitações de plataforma Storage, Auth, Realtime, GraphQL, pg_net e papéis permanecem expressas no parecer.

Execução dos forwards entre **18:18:58.340 e 18:18:58.554 UTC**, no checkout Linux limpo **4850412c19bec6cc4134fb48e1f9e3b4c1ee65fd**. Os 13 arquivos conferiram byte/hash com o manifesto e foram aplicados em uma transação com `ON_ERROR_STOP`, pelo socket Docker Unix fixado, sob `postgres`. Não havia COMMIT, metacomandos ou chamadas HTTP/cron no lote revisado. O [JSON sanitizado](local-forward-evidence-2026-09-28.json) registra lista, hashes, horários e inventários. SQL combinado SHA-256 **dc2f37c1f38ea0762a0e741d4e57e1cc2969ba922c30975c46710403c95d5668**.

Antes/depois: **327 tabelas públicas, zero sem RLS, oito buckets, zero usuários Auth, cron jobs, segredos Vault e itens de fila HTTP**. O ledger histórico permaneceu referência externa. Os artefatos do baseline e a aprovação anterior não foram alterados.

### Contrato de segurança revelou divergência — 18:19 UTC

`supabase/verify/baseline_contract.sql`, SHA-256 **30137b12200c6f924ff534da2164873554f24ff1674bb961fc2b7aa90855d1a7**, foi executado em transação somente de leitura, de **18:19:31.832 a 18:19:31.937 UTC**. Falhou com saída psql **3**: `anon can execute 8 public functions`. A investigação identificou oito funções internas preexistentes, owner `postgres`, retorno `trigger`, ACL nula. Isso não equivale a oito RPCs de negócio expostos, mas viola a regra explícita de privilégios do projeto. Correção em forward novo separado; nenhum gate enfraquecido.

A revisão da seed e do pgTAP também identificou divergências com o contrato publicado: tenant agora requer workspace explícito; claims authenticated requerem active_tenant_id; a jornada antiga usa entrega aposentada e não prepara o controle de carga exigido para partida. Correções das fixtures/testes em andamento, mantendo os triggers e as restrições reais. Seed e jornadas ainda não executadas neste registro.

### Restauração reproduzível

Foram adicionados os [comandos de restauração inicial](local-staging-guide.md#comando-de-restauração-para-um-banco-vazio), com preflight vazio, aprovação/hash externo, SHA limpo, contagens esperadas obrigatórias, transação única, invariantes antes do COMMIT e logs exclusivos privados. Duas revisões independentes não encontraram bloqueador concreto. A execução real das 18:01 usou o runner privado anterior; o novo launcher não foi executado sobre o banco preenchido.

Pipeline com Node **22.23.2** e npm **10.9.4**: **111 testes passaram, zero falhas, um teste de permissões exclusivo de Linux ignorado no Windows**. A conferência Linux e a recusa real de restaurar sobre o banco preenchido serão registradas após transportar o commit limpo. Esses testes verificam a ferramenta, não homologam a aplicação.

No checkout Linux limpo **d457d295d8725e03c97e100d534f800d9488a59f**, os **12/12 testes do launcher passaram**, sem skips. Entre **18:26:14.739 e 18:26:15.839 UTC**, `--check` recusou corretamente o banco preenchido no estágio `empty_runtime_preflight`, código `empty_runtime_preflight_failed`, sem transação de restauração. A consulta seguinte confirmou as mesmas **327 tabelas públicas**. O resultado descreve a ação recusada, não desfaz os 13 forwards já aplicados.

### Lint e advisors locais — 18:27 UTC

CLI **2.116.0**, com flags conferidas por `--help`, workdir `.local-staging` e `--local`. `db lint --level error --fail-on error` terminou com saída **1** entre **18:27:23.799 e 18:27:26.385 UTC**, apontando **35 ocorrências**. A lista inclui seis ocorrências em extensões, rotinas históricas e chamadas que dependem de contexto de tenant; cada resultado exige classificação e reprodução antes de concluir que seja defeito ativo. O gate de lint continua pendente; nenhum filtro genérico foi aplicado para obter aprovação.

`db advisors --type security --level warn --fail-on error` terminou com saída **0**, sem resultados, entre **18:27:37.909 e 18:27:40.663 UTC**. Isso aprova somente essa consulta de advisors nesse instante; não substitui o contrato específico que encontrou os EXECUTEs anônimos nem os testes funcionais. Relatórios integrais ficam no diretório privado Linux; nenhum dado de cliente foi utilizado.

### Complementos revisados e primeira seed — 18:35 UTC

A [revisão dos três forwards adicionais](local-followup-review-2026-09-28.md) registra privilégios de funções internas, remoção de política redundante e duas falhas executáveis de expansão JSON em paletes/financeiro. O [suplemento](baseline-followup-manifest.json) preserva a identidade dos 13 originais. Passaram **5 testes de privilégios**, **9 de visibilidade de chat** e **6 das duas RPCs JSON**, com revisões independentes. Ainda não aplicados ao banco neste registro.

A seed revisada no checkout limpo **bda2c8327a38e5b6c5e67a0b282da701f5d3532b** foi ensaiada de **18:35:50.437 a 18:35:51.009 UTC**. O SQL exige duas workspaces/tenants distintos e sete contas `.invalid`, mantém integrações desativadas e executa constraints antes do COMMIT. Falhou na regra `delivery_result_requires_audited_api`, função `_guard_unrecorded_delivery_metadata`, saída psql **3**. A fixture antiga tentava representar resultado de entrega fora da API auditada atual. O rollback foi confirmado por **zero usuários, workspaces e tenants**; cron/Vault/fila HTTP também zerados. SQL seed SHA-256 **64d7cac44f7b3f2910f289fea93b2b952697c0b83391ec6cd18085d28d229709**. A correção deve preservar a regra e criar um estado de fixture válido; nenhum trigger será desligado para contornar esse erro.

O pgTAP candidato foi atualizado para **108 verificações**, com custódia de carga e entrega atuais, replay/conflito fiscal, restrição de uma viagem ativa e erro explícito do contrato aposentado. Ainda não executado porque a seed não concluiu. As mudanças em fixtures não contam como teste aprovado antes do ensaio real.

Após acrescentar os testes dos forwards e do suplemento, o pipeline executado com Node **22.23.2**/npm **10.9.4** passou em **138 testes**, sem falhas; um teste de permissões Linux foi ignorado no Windows. O checker confirmou **13 originais + três complementos revisados**. O teste Linux correspondente já havia passado na rodada do launcher. Esse resultado não substitui o contrato integral, pgTAP ou E2E.

### Preflight do complemento impediu sobreposição de fonte — 18:40 UTC

No checkout limpo **0b592fef70cfef0beff006a1654683a1aa05b5a5**, a tentativa transacional dos três complementos foi interrompida entre **18:40:43.472 e 18:40:43.549 UTC** pelo preflight: `JSON ordinality body changed: public.edit_pallet_return_protocol_v1(jsonb)`. O patch candidato tinha sido testado com o corpo histórico mais novo; a fonte publicada capturada usa um corpo compacto anterior, também sem os validadores de paletes inteiros. A função de paginação capturada também ainda não contém o resumo integral de recibos do histórico. Não tratar essas diferenças funcionais como whitespace.

Saída psql **3**, conexão encerrada e transação revertida; o inventário confirmou os mesmos oito EXECUTEs anônimos, 327 tabelas e zero usuários/estados externos. Nenhum dos três complementos foi persistido nessa tentativa. A versão recusada do terceiro arquivo tinha SHA-256 **18dbd1debc36cb282db1ccd5237d5ac5992a371e1a363c9ad736324dab8e93c1**; a tentativa e os bytes permanecem no histórico. Sua revisão, antes de qualquer aplicação bem-sucedida, deve aceitar somente os corpos exatos revisados e testar a fonte capturada. Validação de paletes e resumo financeiro terão forwards próprios.

### Contrato integral de segurança aprovado — 18:42 UTC

Os dois primeiros complementos, independentes do SQL de ordinalidade, foram aplicados em transação própria entre **18:42:15.628 e 18:42:15.770 UTC**, no mesmo SHA **0b592fef**. O contrato `baseline_contract.sql` foi executado dentro dessa transação antes do COMMIT e passou. [Evidência sanitizada](local-security-followup-evidence-2026-09-28.json): **zero funções da aplicação executáveis por anon**, 327 tabelas e estados externos vazios. São **13 forwards originais + dois complementos** persistidos nesse instante; o terceiro permanece pendente.

### Seed legítima e primeira suíte integrada — 18:43–18:45 UTC

A fixture revisada conserva documento `confirmed` e POD `pending`, sem destinatário, assinatura ou evidência de entrega inventados. No checkout limpo **6606d3a929b5d449026dd20f73e44e0b770067c0**, a seed concluiu entre **18:43:01.460 e 18:43:01.957 UTC**: **sete usuários sintéticos, duas workspaces, dois tenants, zero flags de integração habilitadas, cron/Vault/fila HTTP vazios**. [Evidência da seed](local-seed-evidence-2026-09-28.json). Constraints foram verificadas antes do COMMIT; a proteção de entrega permaneceu ativa.

A primeira chamada da CLI `test db` não iniciou testes porque procurou a rede Docker padrão, ausente neste ambiente. A imagem `pg_prove:3.36`, digest `sha256:eda7c5e68719e9c8287e78c017118407b48df904a51c935f5ab6098b8c0bc6bc`, foi obtida pela CLI. Com a opção documentada `--network-id agvlog-local-staging-loopback`, a suíte executou entre **18:45:15.010 e 18:45:17.878 UTC**: **110 verificações, 105 passaram, cinco falharam**, saída **1**. [Evidência do pgTAP](local-pgtap-evidence-2026-09-28.json).

As falhas foram quatro assertions do convite (`invitation_access_not_found`) e uma expectativa de total zero após excluir item. O contrato atual usa `prepare_auth_invite_v2` com papel de acesso; a API de exclusão remove a carga elegível quando fica vazia, por isso a consulta antiga retornou NULL. Atualização das expectativas em revisão, sem relaxar regras da aplicação. A jornada SQL de custódia, partida, entrega, snapshot fiscal e replay passou, mas isso não aprova upload real, login, interface ou integração externa.

## 28/09 — 18:48:57–18:49:00 UTC: pgTAP integrado aprovado

No SHA `5436bf76e9265441f83a725195048f561c608a9e`, `supabase test db --local --workdir .local-staging --network-id agvlog-local-staging-loopback --agent yes` executou **114/114 verificações com sucesso**. [Evidência sanitizada](local-pgtap-114-evidence-2026-09-28.json); SQL SHA-256 `78b92c09f8df4853a4fabcdc3436c1c695fff937c35dfb3974aed862ad2f4ddc`.

As cinco falhas anteriores eram expectativas desatualizadas: o convite vigente exige `prepare_auth_invite_v2` com papel explícito; a exclusão auditada do último item remove legitimamente a carga elegível vazia. Os testes foram alinhados aos contratos capturados, ampliados para 114 asserções e executados em transação com rollback. Incluem isolamento, convite, operação e jornada de entrega; os sete usuários sintéticos do seed permanecem. Não comprovam upload físico, navegador, emissão fiscal ou integração externa. Hook Auth e frontend ainda pendentes neste ponto.

## 28/09 — revisão dos cinco forwards funcionais pendentes

A revisão independente e os testes reais PGlite fecharam os candidatos de ordinality (9 testes), rotas (6), auditoria fiscal (12) e integridade de paletes/resumo financeiro (15). A [revisão do suplemento](local-followup-review-2026-09-28.md) registra o erro de fixture da primeira tentativa, os hashes anterior e corrigido e a ordem exigida. O manifesto original de 13 arquivos e os dois forwards de segurança já aplicados não foram alterados. Aplicação no banco local e verificação nativa desses cinco forwards ainda pendentes nesta entrada.
## 28/09 — 18:57:38 UTC: cinco forwards funcionais aplicados

SHA `573f2f32a584f3d2997bd2ec5254623fe511bde2`, checkout Linux limpo, baseline aprovado `501f7c02…`, hashes do suplemento e de cada SQL conferidos. Cinco arquivos pendentes foram aplicados em uma única transação, com `ON_ERROR_STOP`, timeout e `baseline_contract.sql` antes do COMMIT. **Sucesso**, [evidência](local-functional-followup-evidence-2026-09-28.json). Entrada SQL SHA-256 `080bad760b0dddb4e21f052f6021046ebdcc53a1bd20d48809073870caee5456`. Estado passou a **13 originais + 7 complementos**. Permaneceram 327 tabelas públicas, sete usuários, zero funções de aplicação executáveis por anon e zero cron/Vault/fila HTTP. Nenhuma publicação em produção.

## 28/09 — 18:58:22–18:58:31 UTC: verificações após o lote

- **pgTAP 114/114 PASS**, mesmo SQL de segurança/jornada, transação com rollback: [evidência](local-pgtap-post-followups-evidence-2026-09-28.json).
- `db advisors --local --type security --level warn --fail-on error`: **exit 0, No issues found**, 18:58:29.247–18:58:31.978 UTC.
- `db lint --local --level error --fail-on error`: **exit 1, 31 achados**, 18:58:26.211–18:58:28.623 UTC. Os quatro defeitos de caminhos ativos tratados pelo lote desapareceram; permanecem os 21 achados em rotinas legadas, dois FOREACH, dois dependentes de contexto e seis internos PostGIS descritos na [triagem](local-database-lint-triage-2026-09-28.md). O gate não foi liberado nem recebeu exclusões.
- Suíte de scripts no Windows, Node 22.23.2/npm 10.9.4: **174 aprovados, zero falhas, um teste de permissões exclusivo de Linux ignorado**. Esse resultado cobre o estado de arquivos no momento da execução; não aprova automaticamente mudanças posteriores do perfil Auth.

Logs detalhados preservados em diretório privado com nomes por execução. Login real, armazenamento físico, interface e integrações externas continuam pendentes. As correções específicas receberão testes nativos de seus efeitos além do pgTAP geral.