# F05 - identidade do binding fiscal durante GET - 2026-10-06

Responsável: CodexFiscalBinding. Task driver-fiscal-file-binding-20261006; worktree F:/AGVLOG/work/driver-fiscal-file-binding-20261006. Base preservada c146acfabfa05aa603c412f64309e9d219106594, tree 56ecb1ec70f608abc65be9716af83d5dc617d89e. SHA/tree final e hashes de evidência estão no handoff externo merge-20261006/fiscal-binding, sem autorreferência neste documento. A fonte F05 original permanece congelada e sem edições.

## Falha reproduzida

O helper validava o binding atual, mas retornava somente o token. Depois do GET, o handler comparava apenas esse token. Uma troca congruente do emitente A para B no documento e na emissão, com emitente B existente no mesmo tenant e credencial habilitada usando exatamente o mesmo token, mantinha o descriptor RPC e liberava bytes obtidos no contexto anterior.

Antes da correção produtiva, os dois novos casos CT-e e NFS-e falharam com HTTP200 recebido em vez de HTTP409: 2 falhas esperadas, 43 casos fora do filtro. Execução Node22 local, Auth/DB/Hub sintéticos. Log original preservado: C:/Users/Thomaz/Documents/Codex/2026-10-01/task/merge-20261006/fiscal-binding/logs/repro-1791294633614.log. Esse resultado comprova o caso no handler real com clientes controlados; não comprova o gateway ou baseline nativos.

## Correção

driverFileCredential retorna token e bindingFingerprint. O fingerprint é uma serialização canônica de identidades não secretas: tenant, kind/documento local, emitente, ID da emissão, ID Hub/tipo/ambiente e ID/escopo/ambiente da credencial efetivamente selecionada. Nenhum token, ciphertext, nome de secret, dica de credencial ou erro nativo compõe o fingerprint. A estrutura permanece em memória no servidor, sem resposta, log ou persistência nova.

O handler captura essa identidade antes do GET e compara fingerprint e token após I/O, além dos guards existentes de Auth, RPC e capability. Rebind congruente passa a retornar FILE_CONTEXT_CHANGED/409 sem bytes fiscais; dados ausentes/inconsistentes continuam negados. IDs de emissão e credencial já existem no schema, sem migration ou grant novo.

## Validação local

Node22.23.2/npm10.9.4; dependências próprias instaladas offline com ignore-scripts e configuração npm vazia. Não foram alterados node_modules das fontes congeladas ou do revisor.

Após o patch: 74/74 testes em quatro suites F05 passaram, incluindo o controle de binding estável, os dois rebinds congruentes com token/descriptor iguais, mudanças congruentes de emissão/credencial/ambiente/escopo e ausência de material secreto no fingerprint. Os testes verificam HTTP409/erro sanitizado sem bytes, duas autorizações caller RPC e somente um GET upstream. Typecheck global, lint dos três arquivos TS alterados com zero warnings e Edge syntax 105/105 passaram. Comandos, horários UTC, exits e logs constam em logs/checks-results.json no handoff.

Auth e transporte da nova Edge usam clientes sintéticos. A suite SQL existente executa RPC/RLS reais em PGlite com schema/seed parciais em memória; isso não aprova banco nativo. Não houve Deno/gateway, Hub real, navegador nativo, réplica, serviços, credenciais reais, emissão, entrega on-demand, refresh fiscal ou publicação. CI completo e homologação nativa do SHA combinado continuam pendentes.

## Escopo e retorno

Delta limitado a credentials.ts, handler.ts, driverFiscalFileTransport.test.ts e este documento. Proxy, transporte, shared, config, migrations, frontend, AGENTS e serviços ficam preservados. Não há dados persistentes novos. Restaurar os dois arquivos produtivos ao pacote c146 reintroduz o defeito reproduzido; não é retorno funcional aprovado. Integração formalizará freeze e validação da árvore combinada; esta task não foi enfileirada, integrada ou publicada.
