# Log de release — canhotos, atendentes e produtos do motorista

## Identidade e estado

- Responsável: Codex. Base: `6826fcec654296e16fcfa8486df549ca20903430`.
- Checkout isolado em C:, autorizado pelo usuário; fontes e manifests anteriores preservados.
- Alvo: AGVLog / `qcvnsdrbcchaxvawcngk`. Estado: preparação; sem publicação desta mudança.
- Candidato, PR, CI completo e alias final: pendentes.

## Estado anterior e retorno

- Banco observado em 24/11: 953 migrations, última `20261116161511`.
- Fontes anteriores dos leitores e definição da view: `invoice-products-previous-contract.json`.
- Chat: fontes, hashes, ACL e retorno em `agent-chat-previous-functions.json`, `agent-chat-sql-contract.json` e `agent-chat-compatible-rollback.sql`.
- Ordem: chat → produtos → contratos SQL → frontend. Sem alteração/publicação de Edge Functions.
- Retorno de frontend para a versão anterior é compatível: campos JSON extras são opcionais e itens separados já eram suportados. Manter a coluna, view e comparação compatível do histórico; não apagar nem reagrupar produtos, fotos ou conversas. Se necessário interromper somente a expansão futura com `invoice-products-compatible-rollback.sql`.

## Contrato e riscos

- Captura usa toda a imagem do sensor; correção determinística de iluminação, original preservado. Sem reconstrução generativa de escrita ou assinatura. Qualidade é avaliada antes do tratamento. Foto ilegível continua pedindo nova captura; bordas inconclusivas permitem revisão da foto inteira.
- Original e imagem tratada são gravados em IndexedDB antes de aceitar a captura. Escopo inclui empresa, usuário, viagem, parada e evento. Recuperação após recarga; eliminação somente após confirmação do transporte existente. Sem espaço local, o erro é explícito. A cópia local não substitui a confirmação da entrega no servidor.
- OCR OpenAI ativo v18, bundle `0dbd0db1b1053e2a36bb8c32af79dd14cb5af7a06825d181fbcc01351dfb282f`. Autoteste sintético real HTTP 200, `passed`, duas imagens, zero registros produtivos criados; OpenAI `gpt-6-luna`, 1.376 tokens de entrada e 174 de saída. Cron existente ativo. Não foram modificados secrets.
- Chat mantém conversas distintas por atendente, outbox e isolamento de participantes; histórico geral preservado. Nenhuma mensagem real enviada como teste.
- Próximas importações XML guardam código, descrição, unidade e quantidade por linha. Não há reconstrução nem alteração de notas antigas baseadas em resumo.
- Trigger expande a primeira inclusão da nota na carga dentro da transação existente; mantém identidade fiscal e totais de peso/volume/paletes. Peso e volume são alocações contábeis por valor dos produtos (ou quantidade se valor zero), não pesos medidos por SKU. Paletes permanecem na primeira linha para evitar multiplicação. Valores fiscais e frete não são alterados nem expostos ao motorista.
- A view `current_load_items` conserva `security_invoker` e o filtro de tentativa. Histórico anterior sem `source_product` é normalizado somente quando o campo atual é nulo. Produtos novos continuam sujeitos à comparação integral da identidade; snapshots imutáveis não são reescritos.
- As fontes SQL antigas contêm CRLF; preflight compara corpos com CR removido, preservando todos os demais bytes. Hash da view live é registrado no backup; deparsers PostgreSQL/PGlite diferem, portanto CI verifica estrutura e autorização, sem aprovar uma definição diferente por hash alternativo.

## Validação

- 55 testes focados passaram antes dos últimos complementos; seis testes nativos PGlite de produtos e três de parser/fonte passaram depois.
- Produto: XML realista com dois itens, quantidades fracionárias; execução da atribuição real; repetição sem duplicar; quantidade inválida atômica; motorista sem autorização não expande; leitor atribuído; devolução de um único produto pelo writer real; histórico anterior legível sem reescrita.
- Navegador sintético: dois testes Chromium passaram, usando câmera/canvas e IndexedDB reais, sem Auth, rede externa, OCR ou dados operacionais. Recuperação após reload e isolamento por parada; imagem vazia permanece rejeitada.
- Chat: testes de banco, interface e outbox; E2E nativo preparado com dois navegadores e Realtime, limitado ao backend descartável `127.0.0.1:55321`. Pendentes no CI do candidato.
- Typecheck local passou. Quality gate completo, contratos PostgreSQL hospedados, build e smoke do alias: pendentes.
- Primeiro candidato `2c708c726276b3277b23f4aaa715f345f2981b79`, PR #35, run `45479486863`: oito shards unitários passaram; validate bloqueou o build pelo App de 501,7 KiB. Corrigido com imports assíncronos de tratamento da imagem e limpeza da cópia local, sem elevar o limite. Build local subsequente passou: App 499,3 KiB; artefato público sem sourcemaps ou segredos reconhecidos. 84 testes focados de scanner/envio passaram novamente. A correção será validada em novo SHA completo.

## Limitações de homologação

Não foram emitidos documentos fiscais nem alteradas entregas reais para ensaio. Sucesso de captura/OCR sintético não garante leitura de fotos desfocadas, cortadas ou com escrita ilegível. A equipe deverá conferir o primeiro canhoto operacional após a publicação. As notas antigas sem XML detalhado permanecem fora da separação por produto.
