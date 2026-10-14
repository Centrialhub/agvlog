# Ambiente fechado do Supabase CLI no preflight local — 2026-10-14

Task `native-ci-local-cli-env-20261014`, owner `CodexNativeCiCliEnvironment`, checkout `F:/AGVLOG/work/native-ci-local-cli-env-20261014`. Base congelada `9496a02b07ba6521790350c0499ecec1c18ecb73`, tree `b4c1a9c4de4c4c5c9bd1ec3ee383f720d2c7128b`. Reserva de cinco caminhos e ownership check confirmados pelo coordenador antes de editar/testar. Revisão, commit, composição e congelamento pertencem ao coordenador.

## Problema observado e correção

O executor raiz relatou que a probe pública isolada da imagem PostgreSQL passou: usuário postgres, rede none, root filesystem read-only, exit 0 e nenhum volume/container remanescente. O CI literal seguinte iniciou nove containers, mas o restore terminou em `empty_runtime_preflight_failed` às 09:04:12 UTC. A raiz confirmou no workdir correto do run V5 (`source-v4`) o arquivo `.local-staging/supabase/.temp/cli-latest` com zero bytes, SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`, e mtime no mesmo instante. A execução pura do validador real recusou exatamente `Invalid local CLI metadata size.`. Esses dados de runtime foram fornecidos pela raiz; este executor não abriu logs privados, credenciais nem executou o runtime.

Os dois scripts reconstruíam um ambiente com somente PATH/HOME/LANG/DOCKER_HOST. Assim, flags de notifier/telemetry do executor não alcançavam o filho do restore e as chamadas CLI do verifier. O delta de código de produção é somente quatro propriedades: `SUPABASE_NO_UPDATE_NOTIFIER: '1'` e `SUPABASE_TELEMETRY_DISABLED: '1'` em cada `localEnvironment`, em `restore-local-staging-baseline.mjs` e `verify-local-staging-runtime.mjs`.

O ambiente continua fechado, com exatamente seis campos, sem espalhar `process.env`. CLI 2.116.0, caminho `node_modules/supabase/dist/supabase.js`, socket, timeouts, etapas, validadores, limites e allowlists permanecem iguais. Nenhum cache é preenchido, removido, corrigido ou aceito por esta mudança. Nenhuma alteração de SQL, migrations, schema, ACL, RLS, aplicação, SDK, workflow ou daemon pertence a este delta.

## Cobertura e reprodução local

`restore-local-staging-baseline.test.mjs` passa a exigir os seis campos e as duas flags em todos os subprocessos simulados, inclusive o verifier, e confirma que cache vazio surgido durante preflight impede SQL/logs sem reescrever os artefatos preparados. A assertion de ambiente existente foi ampliada de quatro para seis campos exatos; nenhuma assertion de proteção foi removida.

O novo `verify-local-staging-runtime.test.mjs` executa o corpo original do verifier em VM com apenas fronteiras de OS/processos/HTTP simuladas e o validador real de arquivos sobre fixtures próprios. Cobre flags ausentes ou `'0'` no processo pai, sem herança de credenciais; preservação de metadata canônica por bytes/mtime; recusa de cache vazio antes de processos; recusa de cache vazio criado durante status; e redação de erros de subprocesso. A transformação de imports é restrita aos sete imports originais e `import.meta.url`; não há adaptação no executável de produção. Esses testes unitários não homologam Docker, SQL, Auth nem o CI literal.

Node Windows absoluto qualificado: `C:/Users/Thomaz/AppData/Local/npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe`, versão 22.23.2, SHA256 `0d0f5e39f9f3d9587bc19f73eab3c2c9c4903fd02d6dbf9c853dd81b3d95fad4`. Testes usaram HOME/TMP/TEMP próprios em `Ctask/native-ci-local-cli-env-20261014`, sem ler ambiente de credenciais ou configuração privada.

As mesmas quatro suites foram executadas antes e depois das quatro propriedades:

```
node --test scripts/prepare-local-staging.test.mjs scripts/local-staging-baseline.test.mjs scripts/restore-local-staging-baseline.test.mjs scripts/verify-local-staging-runtime.test.mjs
```

- Antes, 09:35:36 UTC: 82 casos, 77 passaram, quatro falharam por falta das flags, um skip já existente de permissões Linux. As quatro falhas foram duas assertions de ambiente de restore e duas simulações de CLI no verifier. Cache vazio pré/pós-status e demais guards passaram.
- Depois, 09:36:43 UTC: 82 casos, 81 passaram, zero falhas, um skip existente de permissões Linux. Todos os sete casos novos e a assertion existente ampliada passaram. Nenhum skip foi adicionado.

As suites de preparação/baseline continuam sem alterações e cobrem cache vazio, metadata fora dos limites, semver inválido, arquivos desconhecidos e links. Os testes de junctions Windows passaram na execução local qualificada. Uma tentativa inicial sob sandbox default encontrou oito EPERM em criação de junctions; o mock inicial também comparava arrays de realms diferentes. O mock foi corrigido antes da reprodução qualificada, e a tentativa inicial foi preservada, sem contar como evidência do defeito de produto.

Evidências externas à árvore, em `Ctask/native-ci-local-cli-env-20261014`:

- `baseline-qualified/TEST-RESULT.json`: SHA256 `12709fc48f183f7ac0845e2823e6a8f917f7e88a1509a2f062bfe15bb5c3564b`; stdout SHA256 `57d6fc7a6418617c901dac1a07a9821da9483c04743a6d0b2306d7ac724b3ccc`.
- `final/TEST-RESULT.json`: SHA256 `dcf93e349cd50392307062baa5bad16e01aaf8ebd8194d4662d5e4ffc3ff0be2`; stdout SHA256 `cbcacc30c29e5474f90037187c7148f45c6d1f57e8845052353090575d1ea302`.
- Ambos stderr vazios, SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

## Limites e critérios para raiz

Não houve WSL, Native, Docker, SQL, migrations, commit, integração ou publicação neste executor. O skip Windows deve ser exercitado pela raiz em Linux; não se converte ausência de execução em PASS. A raiz precisa revisar o delta, registrar commit/freeze, compor separadamente com as demais tasks autorizadas e repetir o CI literal no SHA combinado com workdir/run/config novos, preservando evidências e o runtime operacional. Os mesmos gates de baseline, seed histórico antes dos 41 forwards, catálogo, runtime, guards e aplicação continuam obrigatórios. Os testes locais comprovam propagação e recusa preservada; não aprovam restauração, fluxo de produto ou publicação.
