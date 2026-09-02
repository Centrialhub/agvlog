# Busca de cliente/fornecedor no RPS avulso

## Diagnóstico

- O campo controlado de `cmdk` usava `onChange`, mas sua API utiliza `onValueChange`.
- O seletor precisa de `CommandList` e gerenciamento de foco compatível com o diálogo; as alterações locais existentes que introduziam a lista foram preservadas.
- Na aba publicada de `/nfse`, a busca vazia foi reproduzida. O console registrava erros de coordenação da autenticação durante o carregamento. O formulário tratava qualquer ausência de `data` como lista vazia, sem informar falhas da consulta.
- Consulta somente de leitura no banco configurado confirmou 510 clientes, todos compatíveis com o filtro original. Assim, ampliar o filtro não explica nem resolve por si só a falha observada.

## Alteração

O formulário usa `onValueChange`, abre o popover como modal, identifica opções pelo ID e aceita nomes sem acentos e CNPJ com ou sem máscara. Ao reabrir uma consulta que falhou, tenta carregá-la novamente; também distingue carregamento, erro com botão de nova tentativa e busca sem resultados. As alterações locais de vínculo `cliente_id` e preenchimento foram preservadas.

## Verificação

Verificação no navegador com o componente real e cadastros fictícios, isolando apenas as consultas e a gravação:

- Cliente e fornecedor aparecem ao abrir a lista.
- Digitação mantém o foco e `sao jose` encontra `São José Transportes`.
- CNPJ com e sem pontuação encontra o mesmo fornecedor.
- Seleção por clique preenche nome, CNPJ, IE, IM, endereço, número, complemento, bairro, município, UF, CEP, código IBGE, e-mail e telefone, com as normalizações existentes.
- Seleção por teclado troca o tomador e limpa campos ausentes do novo cadastro.
- Gravação simulada recebe o `cliente_id` selecionado e os dados preenchidos.
- Uma consulta inicialmente em erro recupera os resultados ao abrir o seletor.

`typecheck`, ESLint do formulário, `git diff --check` e build passaram. Os sete testes existentes de `nfseTomador` e `operatorReferenceHooksFrontend` passaram.

A tentativa de teste completo do modal em jsdom não terminou; essa suíte experimental foi removida e a interação foi verificada no navegador real. Na etapa inicial, nenhum RPS real foi criado ou emitido e a publicação ainda estava pendente.

## Correção complementar após publicação

O commit inicial `07e5a1e2` corrigiu a interação, mas a consulta continuou falhando. O diagnóstico adicional reproduziu a causa com o SDK real do Supabase: os leitores de catálogo e de páginas extraíam `supabase.rpc` sem preservar a instância. A chamada falhava ao acessar `this.rest`, antes de enviar uma requisição ao banco. A correção vincula o método à instância. Não foi necessária alteração de esquema ou de permissões do banco.

`operatorCatalogSdk.test.ts` usa o SDK real com transporte simulado. Os três testes falhavam antes da correção e passaram depois: catálogo de 510 clientes em duas páginas, busca paginada e propagação de erro de autorização. Os dados de endereço são preservados no retorno.

## Ambiente fiscal do RPS

Produção passa a ser o padrão na página NFS-e, no painel da carga e na emissão a partir de NFs. O modal de RPS avulso agora mostra o seletor acima das abas e compartilha seu estado com a tela que emite o documento. A seleção vale para a tela atual; salvar continua criando apenas um rascunho, e a transmissão depende do botão Emitir. O seletor também fica junto às ações da página. Recuperações de transmissões anteriores mantêm o ambiente original.

Validação local: 50 testes passaram em sete arquivos, incluindo consistência do ambiente no payload fiscal; typecheck, ESLint dos arquivos alterados e build:check passaram. A verificação autenticada da nova publicação será realizada sem criar ou emitir documentos reais.
