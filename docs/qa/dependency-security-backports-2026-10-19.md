# Dependências de segurança — conta única AGV/LIRA

Thomaz autorizou ampliar esta tarefa em 19/10/2026 para corrigir as dependências,
incluindo o leitor fiscal, e concluir os gates. Task
`driver-shared-account-20261019`, owner `CodexDriverShared`. Produção permanece
intacta durante preparação e homologação. Não houve emissão fiscal de teste.

## Origens e alterações efetivas

Os tarballs públicos fixos foram conferidos por SRI SHA512 e preservados em
`F:/AGVLOG/checks/security-backports-20261019`. O builder offline
`scripts/build-security-backports.py` reproduz os artefatos, sem upload, resolução
de dependências ou execução de scripts dos pacotes. Não sobrescreve bytes
divergentes. Licenças, autores e fontes originais são preservados.

| Componente | Origem | Compilação local privada | Alteração runtime |
| --- | --- | --- | --- |
| Forge | node-forge 1.4.0 | 1.4.1-agvlog.2 | Exigir contagem exata dos filhos de DigestAlgorithm e NULL vazio; distribuir somente fontes |
| Braces | braces 3.0.3 | 3.0.4-agvlog.1 | Limitar pilha de aninhamento a 128, para chaves e parênteses, antes dos walkers recursivos |

Essas versões identificam **compilações locais**, não releases oficiais. O Forge
adapta as verificações propostas em [PR1152](https://github.com/digitalbazaar/forge/pull/1152)
e [PR1157](https://github.com/digitalbazaar/forge/pull/1157), ainda abertas na
consulta atual. O limite Braces não pode ser desativado por opções do chamador;
padrões acima dele passam a ser recusados explicitamente. Escapes e aspas são
interpretados pelo parser original antes de contar o aninhamento.

Somente `lib/rsa.js` e `lib/parse.js` mudam nos respectivos runtimes. Os manifests
dos pacotes registram versão privada, CommonJS e proveniência. Nenhum consumidor
fiscal foi reimplementado e nenhuma operação emissora foi alterada. O lock teve
somente três entradas modificadas: raiz, node-forge e braces. Todos os demais
registros ficaram iguais à base. Override Braces aponta ao artefato exato da raiz;
chokidar e micromatch resolvem a mesma cópia corrigida.

## Identidades verificadas

| Artefato | SHA256 |
| --- | --- |
| vendor/node-forge-1.4.1-agvlog.2.tgz | a030ce10115256d5f924866d9cb5aa4dbc8dc3fdf8d7e8574f8520b63d2c4a8a |
| vendor/braces-3.0.4-agvlog.1.tgz | 8bc64fccfbfc53afd515628e63ed56a663033fc73765aa27eb371098b63ae094 |
| Forge ESM Edge | 0d168cb2a9b03b7450b5234177247877e0e448baa6d51acb0c26c172abd303ac |

O check obrigatório `check:security-backports`, incluído em `lockfile:check`, fixa
hashes dos tarballs, proveniências, todos os arquivos instalados, a cópia fiscal,
o bundle ESM e o import map. Não confia apenas no número da versão. Cinco testes
executam o check real e demonstram recusa de código fiscal adulterado,
proveniência adulterada, arquivo extra e retorno silencioso ao Forge vulnerável do registry.

O checkout Linux limpo do primeiro candidato de segurança encontrou uma falha de
empacotamento: o verificador esperava `dist`, ignorado pelo Git. Esses bundles
pré-compilados do upstream também não continham a correção. A revisão local 2
exclui `dist` e `flash` do tarball, do manifesto e da cópia fiscal; os consumidores
do projeto usam `lib/index.js` ou o ESM gerado, e não esses subpaths removidos.
Os artefatos da revisão 1 foram arquivados intactos fora do checkout e permanecem
no histórico Git; nenhuma versão foi publicada. O check agora exige inventário
exato, além dos hashes, e recusa a reintrodução de bundle extra. O ESM continua
byte idêntico, com o hash acima, após essa correção de distribuição.

O typecheck no Linux isolado atingiu o heap padrão de 2 GiB do Node e abortou
com erro de memória, após passar instalação, integridade, pipeline e audit. O
comando `typecheck` agora fornece 4 GiB ao mesmo compilador e mantém todos os
flags e regras de tipos. O runner tem limite total de 8 GiB; trata-se de orçamento
de execução, sem skip, alteração de assertion ou mudança de contrato.

## Edge/Deno

O primeiro ensaio revelou que o runtime Supabase não oferece o default export do
CommonJS local. Essa tentativa falhou e não foi publicada. O builder
`scripts/build-forge-edge-backport.mjs` gera ESM, com esbuild 0.25.0 fixado no lock,
diretamente das fontes conferidas e incluindo a licença. Força o caminho de
browser/WebCrypto do Forge. A fonte fiscal mantém o import `node-forge`; seu
`deno.json` agora resolve o ESM local. Não baixa um pacote fictício do npm.

Um contexto mínimo de 65 arquivos, copiado com comparação byte a byte, foi usado
no runtime `public.ecr.aws/supabase/edge-runtime:v1.77.4`, em rede interna própria.
O cliente de teste também ficou nessa rede. Nenhuma porta pública ou credencial
produtiva foi utilizada. Container e rede foram removidos após o ensaio.

Resultado real: PFX 3DES e AES256 abriram, senha incorreta foi recusada e dois
DigestInfo inválidos foram recusados. Apenas metadados booleanos e nomes dos
algoritmos saíram no resultado; chaves privadas e PFX sintéticos não foram
registrados. Isso valida o leitor nesse runtime, sem provar emissão fiscal real
ou compatibilidade com um certificado específico de cliente.

## Antes/depois e limites

- Regressão corrigida de entrada: 12 testes; 5 passaram e 7 falharam nas versões
  originais. Quatro falhas reproduziram aceitação de estruturas RSA inválidas;
  duas reproduziram stack overflow com 4000 níveis dentro do limite de tamanho;
  outra demonstrou que não havia limite para aninhamento sem fechamento.
- Um primeiro ensaio usou 10000 níveis, acima do limite de tamanho original;
  foi preservado como expectativa inadequada e substituído pelo caso de 4000,
  sem reduzir o requisito de rejeição antes da recursão.
- Depois: 38 testes focados passaram, incluindo 12 regressões, seis casos do
  leitor fiscal, upload e a política sem scanner já aprovada pelo DOT.
- Na distribuição revisão 2: instalação offline limpa, cinco checks de integridade
  e 33 testes focados de dependências, certificado e conta única passaram.
- As assinaturas RSA malformadas são fixtures com chave privada sintética
  conhecida: provam a validação estrutural e não uma falsificação remota sem chave.
- Os três CSS do build anterior e posterior são byte idênticos em nome/hash.
- `npm audit --audit-level=high` passou: zero high/critical e cinco moderate.
  Os alertas moderados pertencem à cadeia selector/Tailwind; o backport 6.x
  previamente aprovado pelo DOT e seus checks permanecem intactos. Não se declara
  auditoria sem alertas, e não houve suppression, omit-dev ou redução de severidade.

Evidências: `F:/AGVLOG/checks/security-backports-*`. A regressão Windows geral
inicial teve 8811 aprovações, uma falha e um skip; a falha era uma expectativa
antiga de scanner, incompatível com o PATCH2 publicado. O teste foi atualizado
para exigir a proveniência honesta de arquivo não escaneado, mantendo bloqueio
de escrita direta e quota. A segunda suíte funcional completa passou com 8825
aprovações, zero falhas e um skip preexistente. Os gates da distribuição final no
SHA candidato, baseline integral, Auth e interface continuam exigidos antes da
promoção. O runtime dos gates usa daemon Docker próprio, limitado a 4 CPU/8 GiB;
serviços preexistentes não são destinos de restauração ou teste.

## Retorno

Não restaurar silenciosamente os pacotes vulneráveis. Eventual retorno do fluxo
de motorista deve preservar a correção fiscal e as dependências, além dos vínculos
Auth já criados. Uma reversão desta frente de segurança exige revisão específica,
novos hashes e os mesmos testes negativos, de PKCS12, CSS e runtime.
