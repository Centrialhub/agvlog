# Correção da RPC fiscal ausente — 31/08/2026

O frontend publicado invocava prepare_cte_issue, mas a migração fiscal e as Edge Functions correspondentes não tinham sido publicadas. Foi confirmada a ausência no catálogo do banco; não era somente cache do PostgREST.

## Publicação executada

- Núcleo 20260831124505_fiscal_emission_readiness.sql aplicado no projeto qcvnsdrbcchaxvawcngk. SHA-256 LF: a7531e0705e2f167dd493d83a54b08d15a33e576aebce65a4475089b665e1553.
- O acoplamento a _client_invoice_draft_snapshot foi separado em 20260831144530_attach_fiscal_invoice_gate.sql, NÃO aplicado. Sua proteção permanece obrigatória quando a cadeia de faturas auditadas for publicada; nenhum escritor financeiro legado foi ativado para contornar a ausência dessa cadeia.
- Proxy v69 (JWT obrigatório), webhook v48, polling CT-e v32 e NFS-e v36. JWT/custom auth anteriores preservados. Todos os arquivos remotos conferidos byte a byte com os bundles locais, após normalização LF.
- Chamadas fiscais contidas durante a atualização por fiscal_kill_switch; valor anterior false restaurado e assert_tenant_integration_capability_v1 conferido após a publicação.
- A primeira tentativa de publicar o proxy não alterou a versão: o deploy reutilizou um caminho antigo de import map. Refeito com deno.json explícito e os imports relativos completos.
- O MCP registrou inicialmente a migração própria como 20260831144956. Essa única linha recém-criada foi alinhada a 20260831124505 para corresponder ao arquivo aplicado; o SQL executado e o restante do histórico foram preservados. Cache PostgREST notificado.

## Evidência

- 29 testes de banco/despacho aprovados, incluindo instalação do núcleo quando a função financeira não existe.
- 55 testes de proxy, ambiente, polling e contratos aprovados. CFOP 5352 preservado em todas as representações enviadas ao transporte simulado de CT-e de produção MG→MG.
- Sintaxe das 43 Edge Functions aprovada.
- Ensaio no próprio banco publicado com papel authenticated e cadastro existente: reserva de produção com CFOP 5352, repetição recuperando a mesma operação, e rollback integral. Nenhuma chamada ao Hub foi feita por esse ensaio; ausência de reservas e marcas de emissão confirmada em seguida.
- HTTP PostgREST passou de função ausente para recusa correta do chamador anônimo (401/42501). Proxy e polling recusaram chamadas sem autenticação (401); webhook sem segredo retornou 403. Isso verifica publicação e fronteiras de acesso, não uma emissão fiscal autorizada.

## Correção subsequente de acesso do preview

A tentativa pela tela avançou até a reserva, mas o navegador recusou a Edge Function. A preflight OPTIONS do endereço de preview recebia Access-Control-Allow-Origin do domínio lovable.app. Logs mostraram OPTIONS sem POST autenticado correspondente; não havia intenção de despacho no ledger.

- Publicado proxy v70, polling CT-e v33 e NFS-e v37, mantendo JWT/custom auth. Os arquivos remotos foram comparados aos bundles locais e coincidem. Webhook permanece v48, sem alteração nesta correção de navegador.
- Helper fiscal-cors.ts aplica a política à resposta inteira, incluindo OPTIONS, erros de autenticação, erros de capacidade e respostas de negócio. Mantém o domínio principal validado por AGVLOG_APP_ORIGIN e permite apenas o endereço exato do preview de faturamento conhecido. Não aceita wildcard nem todos os sites do mesmo serviço de hospedagem.
- AGVLOG_FISCAL_PREVIEW_ORIGINS pode substituir a lista de previews por origens HTTPS exatas, separadas por vírgula. Valor vazio desativa a permissão de preview; remover a entrada padrão quando esse preview for aposentado. A configuração principal inválida continua fechada.
- 18 probes HTTP remotos nos três endpoints: preview e produção tiveram OPTIONS 200 com a origem correta; POST sem usuário foi recusado com 401 legível pelo navegador. Outro subdomínio de hospedagem teve OPTIONS/POST 403 sem permissão de origem. Nenhum probe emitiu documento.
- 12 casos unitários de CORS e dois casos no handler real do proxy passaram, cobrindo origem exata, rejeição antes do despacho, preservação de erros/cabeçalhos, servidor sem Origin e aposentadoria do preview.

## Verificação final do código

- Suíte completa: 2.684 testes aprovados em 226 arquivos, Node 22, checkout isolado com arquivos LF para preservar os hashes SQL auditados (290 segundos).
- TypeScript, ESLint dos testes alterados e baseline de qualidade aprovados; 98/113 avisos de any, sem novos arquivos acima do limite.
- Build de produção, limite de bundles e inspeção do artefato público aprovados. Nenhum source map ou padrão de segredo reconhecido no artefato.
- Sintaxe final: 44/44 arquivos TypeScript de Edge Functions aceitos.
- Esse resultado valida a correção de software. A confirmação de autorização fiscal real continua separada e pendente.

## Teste real solicitado

Usuário autorizou uma tentativa de CT-e em produção, restrita à NF 447165 com CFOP 5352. A automação Browser não iniciou (trusted Node process exited, inclusive após reset); foi solicitada a confirmação pela própria sessão do usuário, para então acompanhar a mesma operação no banco/Hub. Não criar outra intenção se o retorno for incerto.

Após a tentativa bloqueada por CORS, a NF 447165 permaneceu sem marcas de emissão, com uma única reserva de produção cujo snapshot contém CFOP 5352 e sem emissão registrada no Hub. Essa reserva foi preservada; foi solicitada uma nova confirmação da mesma prévia, sem alterar dados, para recuperar a operação existente.

Não há, neste registro, alegação de autorização SEFAZ ou sucesso de emissão real. Homologação continua dependendo de credencial própria. Os dados de prova, tokens e XMLs não foram adicionados ao repositório.
