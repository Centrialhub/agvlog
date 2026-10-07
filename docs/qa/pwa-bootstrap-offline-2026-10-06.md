# PWA A8/A14: bootstrap completo offline

Base c461f8ecf90306797b3c25e9fdbe3d8753a7e859. Escopo frontend/build/service worker, sem SQL, alterações de Auth/RLS, writers, UUID ou replay.

## Bloqueio e reprodução

O handoff somente de leitura task-3/c461-A8-A14-NATIVE-PWA-BLOCKER.json comprova três módulos obrigatórios ausentes: AppErrorBoundary,frontendTelemetry,performanceTelemetry. main.tsx aguarda todos antes de renderizar App; a seleção anterior de Vite percorria somente imports estáticos dos chunks. A instalação podia terminar sem os três imports dinâmicos de bootstrap. A gravação em runtime clonava tarde, sem waitUntil. Esse risco de runtime não foi usado como prova única da causa nativa.

O teste local antes gerou o build realc461, fez primeiro uso online e instalação natural do SW, fechou o processo Chromium e reabriu sem acesso à origem. Os três módulos ausentes permaneceram fora do cache e a tela BootstrapFailure apareceu. Não houve cache.put/aquecimento manual de módulos obrigatórios. Tentativas iniciais da fixture foram descartadas porque um worker reativado escapava da emulação de rede; a fixture passou a indisponibilizar somente seu servidor loopback próprio durante os períodos offline, além de setOffline/CDP e HTTP disk-cache desativado. Nenhum serviço do revisor é iniciado/parado.

## Mudanças

Vite inclui todos os imports dinâmicos diretos da entrada obrigatória e suas dependências estáticas. As dependências lazy do motorista/Auth são resolvidas pelo grafo de módulos fonte do Rollup, evitando tratar todos os lazy imports de um chunk compartilhado App como dependências de uma única rota. A seleção é ordenada e testada contra ciclos, ordem, caminhos Windows e módulos externos. Os assets continuam públicos e identificados pelo digest do build; módulos de código não substituem autorização.

main mantém a validação da configuração pública antes de importar SDK/App. O registro de SW começa nessa mesma fronteira válida antes de aguardar bootstrap: permite buscar uma atualização mesmo se um shell antigo falhar. O registro ocorre uma vez; rejeições offline de register/update são tratadas. A ativação continua exclusivamente por ACTIVATE_UPDATE; controllerchange mantém a recarga protegida existente.

O worker instala a lista completa com tipo de conteúdo válido e verifica driver-build.buildHash contra seu BUILD_HASH. Instalação incompleta/misturada é rejeitada e seu cache removido, preservando o build ativo completo. Navigation fallback e assets leem somente o CACHE_NAME do próprio worker. Runtime clona antes de entregar o corpo ao consumidor e registra a escrita em waitUntil sincronamente; falha de cache não impede fetch online. Respostas HTML não são persistidas como JS/CSS, nem privadas REST/Auth/Functions/Storage/Realtime são interceptadas. Prefixos alheios de cache e IndexedDB/storage de actor não são apagados na atualização.

## Testes e limites

O script scripts/test-driver-pwa-bootstrap-browser.mjs compila duas versões reais no checkout próprio e usa servidor loopback com porta atribuída automaticamente e perfis Chromium exclusivos. Faz primeiro uso online/instalação sem reload de aquecimento, fechamento/reabertura, boot Auth offline real, imports de rotas Driver nunca visitadas online e guard anônimo de /driver/expenses. Confere zero pedidos aceitos pela origem durante offline.

Também verifica body consumido/cache runtime, cache alheio, APIs privadas com dois actors sintéticos, rejeição de atualização com módulo obrigatório 200HTML, waiting sem ativação automática, ação explícita/controllerchange e hash ativo. Preserva comando de despesa/PDF próprios sintéticos no schema IndexedDB real, UUID/payload/hash do blob, duas chaves por actor e cache alheio. Fecha/reabre novamente offline no build atualizado. Quando o artefato da prova antes está disponível, cobre instalação antiga genuínac461, falha offline, recuperação online e novo boot offline. A evidência declara se esse caso foi executado; o handoff local inclui o artefato antes.

As esperas assíncronas avaliam booleans verdadeiros e toleram somente destruição de contexto causada pela navegação esperada. O E2E antigo agora exige o formulário Entrar e ausência da tela BootstrapFailure; comprimento de texto não aprova boot. Regressões de upgrade exercitam hash divergente, clone consumido, namespace e bypass de APIs privadas.

Esse teste usa aplicativo/SDK/guards anônimos reais, configuração pública placeholder e IndexedDB sintético; não autentica um motorista GoTrue nem prova RLS/Storage/Edge, replay de banco, concorrência nativa, CI hospedado, instalação em telefone ou produção. Os19objetivos do sucessor seguem pendentes, sem herdar o full gate/shards ou aprovaçõesc461. Retestar A8/A14 com Auth/contexto/PDF nativos e ciclo instalado/fechado/offline/update/recovery.

## Preservação e entrega

Fontesc461/487 e respectivos serviços/testes/réplica permanecem intactos. Manual32 e fontes anteriores/task-2 protegidos. Os26forwards, manifests e A6E1/C8 ficam byte-idênticos; nenhum SQL adicional. Retirada500AuthQA/cópiaAuthStorageA13 não executadas. Sem enqueue/integrate/push/deploy/commit final de release. Congelar SHA/tree limpos com bundle/delta desdec461 e todos os gates locais do mesmo SHA. Rollback frontend pode usarc461 preservado, sabendo que seu PWA offline é falho; preservar outboxes e não alterar banco.
