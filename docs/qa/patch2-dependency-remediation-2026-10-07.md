# PATCH 2 — primeiro delta de dependências

Task `patch2-ssx-dependencies-20261007`, owner CodexPatch2. Base42c/lock histórico idêntico à produção63278f7; audit original06/10:13high/5moderate, quatro raízes. Nenhum audit novo foi executado e nenhuma contagem atual foi inventada.

## Delta source-map-js

Atualização transitiva estreita **1.2.1→1.2.2**, somente `node_modules/source-map-js` no lock. Todos os outros **684 registros** e o package.json permanecem iguais. Dois consumidores existentes (`postcss8.5.26` e `magicast0.5.5`) declaram `^1.2.1`, compatível com o patch. Nenhum override, major, downgrade, auditfix, mudança de gate ou dependência fiscal.

Fontes públicas atuais consultadas em07/10: [advisory GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), [release oficialv1.2.2](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2), [source-node.js do tag](https://raw.githubusercontent.com/7rulnik/source-map-js/v1.2.2/lib/source-node.js) e metadata pública fixa `https://registry.npmjs.org/source-map-js/1.2.2`. Advisory lista1.2.2 corrigida. O pacote efetivamente instalado também rejeita section offset.line acima10.000.000; não basta observar a otimização de SourceNode no GitHub.

Foram permitidos somente dois GETs públicos fixos de metadata/tarball, sem enviar manifest/lock/inventário. Tarball18arquivos,142.723bytes descompactados, sem dependency runtime nova. SRI SHA512 verificado contra metadata:
`sha512-KGj/8Y43x35aZVDtt+J4mK1hoLGHULMYfSkODJNQjNDC3oW1PqPoxMwo0pLUsWM/UEGzON/NxeHywEfNXNP3Vw==`.
SHA256 tarball: `05c8cf8e7c3a6b56cada7668fe9342b10f4b625efc92aba9ba05b9e8fe4d71a3`. Cache add do arquivo local e npmci posteriores inteiramente offline, ignore-scripts/no-audit/no-fund, Node22.23.2/npm10.9.4. Nenhum script do pacote executado.

Proveniência e comparação reproduzível: `C:/Users/Thomaz/Documents/Codex/2026-10-07/task/source-map-lock-delta.json`, metadata/tgz e `edit-source-map-lock.mjs`. Script confere package/version/SRI, ocorrência única, os dois ranges e igualdade estrutural de todas as demais entradas antes de gravar.

Contraprova1.2.1: `source-map-before.json`,1PASS/1FAIL. Mapa sintético indexedoffset10^12 provoca OOM somente no subprocesso próprio com heap64MiB/timeout2s. Nenhum alcance desse sink foi demonstrado em request da aplicação. Primeiro ensaio1.2.2 (`source-map-after.json`) conservado: a biblioteca rejeitou o offset, mas o novo teste inicialmente esperava preservá-lo; esse erro de expectativa não foi marcado como regressão do produto. O teste definitivo exige rejeição explícita acima do limite e preservação de código/fontes nos offsets0 e1.000.000, mantendo o limite de tempo/memória. Resultado do teste definitivo em `source-map-final-working.json`; validação no SHA do commit será registrada no handoff.

## Riscos residuais e deltas seguintes

| Raiz / frente | Fonte atual / decisão |
| --- | --- |
| Forge1.4.0 | [Advisory oficial](https://github.com/advisories/GHSA-86w9-cpqp-85rv) continua sem release corrigida listada. Pin Deno fiscal independente intacto; estudo anterior demonstrou parsingPKCS12/HMAC, não o sinkRSAverify específico. Proposta antes de editar: revisar release/backport com provenance, ensaiar parsing/metadados/erros e verificaçãoRSA negativa sintética, avaliar compatibilidade e retorno da Edge fiscal. Nenhum backport/pin/fluxo emissor foi modificado. Autorização fiscal específica continua necessária. |
| Braces3.0.3 | [Advisory oficial](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) continua sem versão corrigida listada. Lint/CSS/build podem processar entradas não confiáveis; dev não é garantia de segurança. Remover só a ramificação ESLint não resolve Tailwind/Lovable. Sem vendoring ou migraçãoCSS automática. |
| Selector6.x | [Advisory oficial](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) fixa7.1.6; major fora dos ranges atuais dos pais. Exige consumidores compatíveis ou backport revisado e testes deCSS/classes/variants/formulários/PWA. Não forçar override global ou downgrade Typography. |
| Família typescript-eslint8.48.0 | [Release oficial](https://github.com/typescript-eslint/typescript-eslint/releases/tag/v8.48.0) e [manifest typescript-estree](https://raw.githubusercontent.com/typescript-eslint/typescript-eslint/v8.48.0/packages/typescript-estree/package.json) verificados. Continua candidato mesma major que substitui fast-glob por tinyglobby; precisa fechamento coordenado dos pacotes e lint/tsconfig/regra/baseline do projeto. Cache tem8.38 e8.69, não o tarball8.48; não escolher8.69 apenas por conveniência. Nenhum upgrade dessa família executado nesta primeira entrega. |

Não alterar o gate audit-levelhigh, omitir dev ou salvar suppression. A consulta npm audit que transmite inventário permanece negada; os GETs públicos específicos não concedem essa autorização. A atualização demonstrada de uma raiz não significa auditPASS nem remediação dos13high/5moderate inteiros.

## Realtime, recuperação e CI

Revisão estática do hook `src/hooks/useDriverMessages.tsx`: query/channel incluem tenant/actor/kind/id, cancelamento e assert de scope antes de consumir retorno; callback Realtime invalida consulta existente. Polling15s não provaWS. Nenhum bug de produto Realtime novo foi reproduzido aqui; serviços/proxy e runtime/NodeLinux continuam com o revisor/aprovações próprios.

`.github/workflows/quality.yml` conserva validate, audit, oito shards e database-and-e2e. `docs/qa/ci-private-baseline-handoff-2026-10-01.md` exige hash aprovado/cadeia do pacote sanitizado, runner isolado e autorização de transferência/configuração/execução nominal; não criar baseline, URL ou acesso fictício. A13/restore ainda não executados nesta frente. Testes puros desses guards e chat serão executados no SHA próprio; não serão apresentados como CI hospedado, restore integral ou RealtimeNative.
