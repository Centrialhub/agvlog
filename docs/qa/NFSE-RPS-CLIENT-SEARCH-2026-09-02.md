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

A tentativa de teste completo do modal em jsdom não terminou; essa suíte experimental foi removida e a interação foi verificada no navegador real. A versão corrigida não foi publicada. Nenhum RPS real foi criado ou emitido; o fluxo autenticado de produção com o código corrigido ainda depende da publicação.
