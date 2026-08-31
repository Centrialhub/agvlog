# Recuperação da credencial fiscal — 31/08/2026

## Diagnóstico e limite

O erro HUB_CREDENTIAL_DECRYPT_FAILED é gerado pelo AGV Log antes do despacho ao Hub. A credencial de produção do emitente usado no teste foi criada em 24/07 e mantém envelope enc:v1 estruturalmente válido. O gravador original de julho, o gravador publicado e os leitores usam AES-GCM com a mesma derivação de chave. Não foi demonstrado defeito no algoritmo nem quando a chave teria mudado: o registro existente simplesmente não abre com a configuração atual, conforme a tentativa autenticada.

Não foram lidos/exportados token, ciphertext ou chave real. Não foi rotacionada a chave global, que também é usada por outras integrações. O acesso CLI a segredos não está autenticado; o Vault consultado não contém uma chave de criptografia fiscal recuperável por nome. A restauração da credencial antiga exige a chave original correta ou recadastro explícito do token. Não criar chave nova para tentar abrir um ciphertext antigo.

## Correções publicadas

- Codec fiscal único para salvar, emitir e consultar status, compatível com enc:v1. O gravador verifica a leitura do token recém-cifrado pelo mesmo leitor antes de persistir.
- Validação estrita do envelope e autenticação AES-GCM; chave errada, adulteração, formato desconhecido e token vazio continuam bloqueados, sem fallback para outro emitente, ambiente ou token global.
- Mensagem de erro orienta um administrador a recadastrar a credencial no mesmo ambiente, sem alegar falha do provedor ou emissão.
- Salvamento de credenciais agora aceita o endereço exato do preview aprovado pela mesma política CORS fiscal; mantém JWT e autorização owner/admin do tenant. Operadores e visitantes não podem substituir credenciais.
- Versões verificadas: proxy 72, salvamento 49, polling CT-e 35 e NFS-e 39. Arquivos remotos conferidos com os bundles locais, normalizando LF. JWT do proxy e salvamento mantido; autenticação cron/usuário dos polls preservada.

## Verificação

- Nove testes criptográficos, incluindo envelope legado gerado independentemente com node:crypto, nonces distintos, chave incorreta e adulteração.
- Quatro testes de integração dos handlers reais, com banco/transporte simulados: credencial ilegível → token explicitamente recadastrado → ping e leitura por CT-e/NFS-e; respostas sem token/ciphertext/chave; recusas a operador, visitante, origem hostil e anônimo.
- Nenhuma chamada ao Hub nos testes de recuperação. O ping só comprova leitura/configuração no AGV Log, não validade do token perante o provedor.
- Probes HTTP publicados: OPTIONS do preview aprovado 200; POST sem usuário 401 com CORS legível; outro site 403 sem permissão de origem. Nenhum registro real alterado por esses probes.
- TypeScript, ESLint dos testes e sintaxe dos 45 arquivos TypeScript das Edge Functions aprovados.
- Suíte completa: 2.697 testes aprovados em 228 arquivos, checkout isolado LF com Node 22 (292 segundos). Baseline de qualidade aprovado: 98/113 avisos de any, sem novos arquivos acima do limite.

## Recadastro real confirmado

O titular recadastrou a credencial no campo protegido e confirmou no chat. A nova linha de produção, escopo all e emitente correto, foi criada às 15:22:16 UTC. O log registra POST 200 no salvamento v49, cuja execução só persiste após criptografar e ler novamente o token. Nenhum segredo foi retornado pelos testes ou pelas consultas de diagnóstico.

A emissão real da NF 447165 com CFOP 5352 ainda não ocorreu: o ledger permanecia sem despacho às 15:23:06 UTC. Foi solicitada a retomada da mesma prévia, sem alterar o snapshot, porque a conexão Browser da ferramenta segue indisponível. O sucesso de salvamento e leitura não comprova aceitação do token pelo Hub ou autorização SEFAZ.

Não foi transmitido documento, apagada reserva ou criada segunda operação por esta correção.
