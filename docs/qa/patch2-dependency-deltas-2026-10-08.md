# PATCH2: deltas de dependências de 08/10/2026

Task `patch2-dependency-deltas-20261008`, owner `CodexPatch2`, branch `task/patch2-dependency-deltas-20261008`, worktree próprio `F:/AGVLOG/work/patch2-dependency-deltas-20261008`. Base revisada `e2947abc3eb420638934094fe20f31790d5d32de`, tree `6c2e52f819c978ce2b5fa39d14ee62945a9c991e`, preservada por `fork-frozen`. Quatro paths reservados: `package.json`, `package-lock.json`, este registro e `src/test/typescriptEslintProjectCompatibility.test.ts`. Sem mudança fiscal, SQL, serviços compartilhados ou publicação neste delta.

## D-P2-TYPOGRAPHY / CT-DEPS-DELTA

Remoção já commitada em `42b2920d792cc1a511aedd260d41120823b5ff3d`, tree `934cc985421f34cc47704399dd78167f99cce157`. Typography 0.5.16 não está ativo em `tailwind.config.ts`; busca rastreada encontrou somente o manifest, sem classes `prose` na aplicação. Foram retirados o consumidor e três entradas exclusivas: `lodash.castarray` 4.4.0, `lodash.isplainobject` 4.0.6 e sua cópia de `postcss-selector-parser` 6.0.10. Compartilhados preservados, incluindo `lodash.merge`, `cssesc`, `util-deprecate` e duas cópias de selector 6.1.4.

O resolver npm 10.9.4 executado offline alterou também anotações `libc` de três binários SWC e a ordem dos campos de source-map. O resultado bruto foi preservado; essas alterações alheias foram retiradas do delta final. Todas as entradas sobreviventes ficaram iguais à base em sua representação JSON. A análise resolveu consumidores aninhados, sem poda global por nome de pacote.

`npm ci --offline --ignore-scripts --no-audit --no-fund` e builds antes/depois PASS. Os três CSS são byte idênticos em nome, tamanho e SHA-256: App 3075 B, index 106408 B, maps 15037 B. Evidências próprias em `dependency-deltas-20261008/typography-css-comparison.json` e `typography-lock-delta.json`. Inspeção do build final e limites visuais serão registrados no handoff externo após o selo; não antecipam homologação autenticada.

## D-P2-TSESLINT / CT-DEPS-DELTA

Família coerente de onze pacotes atualizada de 8.38.0 para 8.48.0, mesma major, com pin exato no wrapper. Inclui wrapper, eslint-plugin, parser, project-service, scope-manager, tsconfig-utils, type-utils, types, typescript-estree, utils e visitor-keys. Node 22.23.2, ESLint 9.32 e TypeScript 5.8 satisfazem peers e engines publicados. Estree passa de fast-glob para tinyglobby; o grafo já não liga typescript-eslint a Braces. Braces continua pelos consumidores CSS.

Metadata pública em cache e onze tarballs públicos lidos por GET sem credenciais; todos conferidos contra SRI SHA-512. Nenhum manifest/lock foi transmitido e nenhum audit foi executado. O resolver offline normal pediu metadata ausente de `graphemer`; falha preservada em `tseslint-resolve-offline.log`, sem tentativa online para resolver o projeto. O lock foi construído de modo limitado: somente onze entradas e o pin raiz, usando os onze manifests verificados. npm `@npmcli/arborist.loadVirtual()` validou 57 edges, inclusive peers/optional; lock check e npm ci offline PASS. Todas as onze versões instaladas são 8.48.0. Nenhuma outra entrada foi removida, acrescentada ou alterada em relação ao delta Typography.

Configuração efetiva do ESLint antes/depois é estruturalmente igual após normalizar somente rótulos de versão dos plugins. `eslint.config.js`, severidades, regras e baseline não mudaram. Lint completo de erros, lint do teste com zero warnings e typecheck próprios PASS antes do selo.

Nove testes novos executados em 8.38.0 e 8.48.0: 9 PASS / 0 FAIL em ambos. Exercitam TS/TSX válido/inválido, tokens/scopes, projetos múltiplos, globs, exclusões depois de cache aquecido, ordem de configs, diagnóstico semântico e severidades reais. Um ensaio inicial usou glob negativo em `project[]`, que não exclui os outros padrões positivos nessa API. Resultado 8/1 preservado em `parser-before-wrong-ignore-option.json`; corrigida a fixture para usar `projectFolderIgnoreList`, sem skip nem redução das assertions. O comportamento correto de exclusão passa nas duas versões; não foi tratado como regressão do produto.

## Exposição residual e próximos deltas

`dependency-graph.json` resolve os paths reais do lock atual, com menor cadeia por raiz direta e todos os consumidores imediatos. Source-map permanece 1.2.2. Braces 3.0.3 tem pais chokidar 3.6.0 e micromatch 4.0.8, alcançados por Tailwind/Lovable. Selector 6.1.4 permanece em duas cópias: Tailwind 3.4.17 e postcss-nested 6.2.0. Forge npm e Deno continuam 1.4.0. Remover dois caminhos não constitui auditoria externa verde nem remediação integral das quatro raízes históricas.

D-P2-CSS-DEPENDENCIES: proposta concreta externa `PATCH2-CSS-FORGE-PROPOSAL-20261008.md`. Priorizar backport compatível 6.x da correção de parser linear e uma correção de profundidade/recursão Braces, com provenance e pacote reproduzível. Provar todas as cópias físicas, corpus de AST/CSS/classes/variants/escapes/nesting, watchers, visual/formulários/PWA. Sem override global 6 para 7, Tailwind 4 forçado ou mudança de semântica do consumidor neste candidato. As fontes atuais ainda não dão release Braces corrigida; backport é proposta pendente de revisão e implementação.

D-P2-FORGE: proposta de impacto e autorização nominal antes de tocar npm+Deno, módulo fiscal ou testes fiscais. A PR 1152 aberta endurece DigestAlgorithm; PR 1157 aberta acrescenta rejeição de NULL não vazio. Não são release aceita. Leitura estática do consumidor AGVLOG mostra ASN.1/PKCS12/PEM/ICP-Brasil e não demonstra entrada remota no sink RSA verify. Isso não permite presumir inocuidade de tooling dev ou do pin Edge. Zero teste/emissão fiscal executado.

## Integração e limites

Os forwards SSX v2 `20261007122904` e v3 `20261007131504` e o suplemento são do integrador. Os manifests congelados PATCH1 permanecem intactos. Registro/ensaio do integrador em outra task não muda automaticamente o manifest deste worktree; o gate canônico no SHA final será reportado sem bypass. UI, contas e fila de endereços pertencem às frentes próprias. O catálogo consultado em 08/10 agora inclui D-P2-ADDRESS-ROOT-JSON-NULL, atribuído ao dono da fila; este delta não o duplica. R-SSX-SINGLE-POSITION-SATURATION permanece aberto: e294 rejeita posição com resultado >=500 de forma deliberada; aprovação agregada não prova paginação/completude desse caso.

Replica/Native, Realtime, janela A7, recuperação A13 e CI privado continuam dependentes dos responsáveis e aprovações específicas. Seis SQL negados e audit externo negado não foram repetidos; zero chamada SSX externa, credencial nova, integração, push/deploy, produção ou exclusão de contas. D-ACCOUNTS-DELETE continua suspensa. D-HOMOLOG-P2 não é liberada por estes dois deltas enquanto existirem demandas aplicáveis abertas.

Rollback proposto dos deltas npm: commits inversos gerenciados e estreitos sobre manifest/lock em novo candidato, instalação/grafo/gates repetidos e composição revista. Não voltar SSX a leitor pré-fencing nem descartar os deltas de data/escopo herdados de e294. Não executar rollback aqui.

## Fontes e evidências

Resultados próprios em `C:/Users/Thomaz/Documents/Codex/2026-10-07/task/dependency-deltas-20261008/`: SRI/metadata, npm virtual edges, lock delta, installed versions, effective config, parser antes/depois e CSS diferencial. Gates no SHA final ficam no handoff externo, evitando referência circular do commit ao próprio SHA.

- [Wrapper oficial 8.48.0](https://raw.githubusercontent.com/typescript-eslint/typescript-eslint/v8.48.0/packages/typescript-eslint/package.json), [estree oficial 8.48.0](https://raw.githubusercontent.com/typescript-eslint/typescript-eslint/v8.48.0/packages/typescript-estree/package.json).
- [Selector: advisory atual](https://github.com/advisories/GHSA-rj75-hqrm-r3gf), [correção upstream](https://github.com/postcss/postcss-selector-parser/commit/62b1917).
- [Braces: advisory atual](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [issue de recursão](https://github.com/micromatch/braces/issues/70).
- [Forge: advisory atual](https://github.com/advisories/GHSA-86w9-cpqp-85rv), [PR 1152](https://github.com/digitalbazaar/forge/pull/1152), [PR 1157](https://github.com/digitalbazaar/forge/pull/1157).

Fontes relidas em 08/10/2026. Estado externo pode mudar antes de um futuro delta; revalidar nominalmente, sem transmitir manifest/lock para audit sem autorização.
