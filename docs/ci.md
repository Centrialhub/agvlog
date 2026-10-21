# CI commands (AGVLog)

This project uses **npm 10.9.4** and `package-lock.json` as the only install graph.

| Step          | Command                              |
| ------------- | ------------------------------------ |
| Install       | `npm ci`                             |
| Security      | `npm audit --audit-level=high`       |
| Types         | `npm run typecheck`                  |
| Lint          | `npm run lint:errors`                |
| Critical lint | `npm run lint:critical-types`        |
| Edge syntax   | `npm run edge:syntax`                |
| Coverage      | `npm run test:coverage`              |
| Build         | `npm run build:check`                |
| Dev           | `npm run dev`                        |

`npm run check` executa os gates que não exigem Docker. O build falha se algum
chunk JavaScript ultrapassar 500 KiB.

O workflow executa validação, oito shards unitários e o job `database-and-e2e`.
Este último restaura uma base privada revisada em Supabase local, aplica os
forwards aprovados e o seed sintético, executa o contrato de baseline e pgTAP, e roda Playwright em
desktop e 390×844. Os cenários `@critical` são repetidos três vezes. Coverage,
trace, screenshot e vídeo de falha são artefatos por 14 dias.

### Base privada nos executores GitHub

Uma pasta da máquina de desenvolvimento não existe no executor hospedado. O
passo `Provision encrypted reviewed baseline` baixa um release asset cifrado
com AES-256-GCM, confere seu SHA-256, autentica e extrai o pacote em diretório
temporário fora do checkout. Os bytes originais dos manifests e SQL aprovados
são preservados; `ci-reviewed-baseline.sh` continua validando a cadeia completa
de aprovações e hashes antes de restaurar qualquer conteúdo.

Configuração do repositório no GitHub Actions:

- Secret `AGVLOG_CI_BASELINE_KEY`: chave aleatória de 32 bytes em hexadecimal.
- Variable `AGVLOG_CI_BASELINE_URL`: URL do asset `.enc` no release deste repositório.
- Variable `AGVLOG_CI_BASELINE_CIPHERTEXT_SHA256`: SHA-256 do asset cifrado.
- Variable `AGVLOG_REVIEWED_BASELINE_SHA256`: aprovação final revisada externamente.

O pacote usa cabeçalho `AGVBASE1` (também AAD), nonce de 12 bytes, tag GCM de
16 bytes e ciphertext. O conteúdo é gzip de JSON `{formatVersion:1,files}`;
cada entrada contém `path` relativo e `content` em base64. Somente manifests
de aprovação e SQL da base e suas revisões são aceitos. O limite descompactado
é 32 MiB. Não publicar a chave nem arquivos legíveis, não colocar a base nos
artefatos de teste e não usar credenciais ou dados de produção.

A chave só é disponibilizada ao passo de provisionamento. PRs de forks sem
acesso ao secret falham de forma explícita; não trocar para `pull_request_target`
nem contornar a revisão para liberar código de terceiros. Uma nova aprovação
exige empacotamento fiel, novo asset/digest e atualização explícita da configuração.

Não reintroduza `bun.lockb`, `yarn.lock` ou `pnpm-lock.yaml`; divergência de
gerenciador invalida a auditoria do grafo liberado.
