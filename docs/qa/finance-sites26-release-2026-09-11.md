# Financeiro — release Sites26 e Supabase

## Entrega verificada

Main:97633fe36fec031c030fd03a306ff7920383c9c7 (53 arquivos explicitamente incluídos no manifesto). Também inclui commits anteriores1c3b36d9 (mensagens de comprovantes/correção),10c9917e (folha com busca e páginas) e9fbaad59 (núcleo de cálculo da previsão, ainda sem interface/persistência).

Supabase AGV LOG qcvnsdrbcchaxvawcngk recebeu três migrações autorizadas:

| Arquivo | Versão remota | SHA256 dos bytes aplicados |
|---|---|---|
|72557finance_unloading_covered_cost_regularization|20260911075522|cd41a809dfe98661351f9e9cdfc446169ea08289e723f678a66635ed6b288c9f|
|72723finance_effective_cost_disposition_readers|20260911075537|bdb264f011b63f4d9f42326fdf17c2096a429bdef163ad35220de2ccaa4520a6|
|74203finance_unloading_cost_regularization_public_boundary|20260911075547|d7b3f00fb00fe01db1488c274b818d25eb6043deb6a3f079b5126e7a7cfac351|

Predecessores remotos das cinco funções de leitura e do resolvedor conferidos antes da aplicação. Boundary74203 confere13 corpos/configurações/ACLs e guardas antes de expor os wrappers. Diferença dos hashes de core durante integração foi de normalização CRLF: catálogo final de dependências usa prosrc normalizado; não houve relaxamento do corpo aprovado.

Pós-aplicação: movement_correction_readiness.ready=true, account_period_guards_ready=true, cash_period_guards_ready=true. Authenticated executa wrapper público; anon não; rawwriter e tabelas privadas inacessíveis a authenticated; rawwriter inacessível também a service_role. Contadores expenses/movements/regularizations/dispositions permanecem0. Portanto esta rodada não prova preservação de lançamentos de cliente existentes: não havia linhas nessas fontes. Nenhum lançamento ou documento fiscal foi criado no remoto.

## Validação local

TSC35429 e buildcheck4772 encerraram0 após as últimas alterações de UI,4655módulos,20.03s. Artefato sem sourcemaps nem material secreto reconhecido.53 testes UI/12arquivos passaram na rodada final do agente. SQL:5core,2leitores amplos,3boundaryroot,2boundaryindependentes passaram.19 regressões de custo/comprovantes passaram em rodada separada; esses testes antigos não substituem os novos testes que instalam72557/72723/74203 juntos. Núcleo de previsão:12testes. Folha:4testes com125funcionários.

Os testes SQL usam PGlite e fixtures de dependências com writers reais; não são ensaio do schema Supabase inteiro nem concorrência PostgreSQL nativa da nova regularização. Testes com schemas públicos comprovam os contratos desta integração, não autenticação de navegador.

## Sites

Source db127196dd1bb6aaae60f63e69dd71ff42809b15, push confirmado antes de salvar.
Version appgprj_6a958c7d22dc8191840efb545d976b79~appgver_13967dd148048191889ce1a649b1f5e5.
Deployment appgdep_6aa3b4c880d481918954c9fca61b08c5, succeeded2026-09-11T07:59:57.416963+00:00.
URL https://agvlog-preview-thomaz-20260831.veituma.chatgpt.site.
Archive F:/agvlog-main/.sites-artifacts/finance-covered-cost-20260911.tar.gz,sha256b030c7fb0f690be200be55def241eb70394f4377b36c3f5d62cc2c3f4a350baa,8.898.560bytes,336arquivos.
Audiência existente public preservada e autenticação do aplicativo mantida. Secure-upload segue versão25, sem redeploy neste lote. Source-state declara working_tree_delta=true pelo workspace compartilhado; não foi apresentada revisão main como reprodução isolada de todo frontend operacional.

## Pendências do objetivo completo

Retorno real de disposição está sendo implementado em candidata74603 ainda não aplicada. Compensação, complemento aberto e reconstrução de acerto/folha materializados continuam pendentes. Previsão exige coletor autorizado, histórico imutável e comparação com realizado; cálculo puro não é funcionalidade pronta. Paginação de folha é de apresentação, RPC ainda transfere projeção inteira.

QA integral autenticado continua sem sessão disponível ao agente. Não foi contornada a rejeição anterior da revisão automática ao acesso administrativo para criar contaQA, e não houve autorização nova a esse pedido. A publicação não equivale a aceite completo do módulo. Estimativa comunicada ao usuário: cerca de80%, com confiança moderada, não medição automática nem conclusão demonstrada.
