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

O segundo job do workflow recria um Supabase local, aplica todas as migrações e
o seed, executa o contrato de baseline e pgTAP, e então roda Playwright em
desktop e 390×844. Os cenários `@critical` são repetidos três vezes. Coverage,
trace, screenshot e vídeo de falha são artefatos por 14 dias.

Não reintroduza `bun.lockb`, `yarn.lock` ou `pnpm-lock.yaml`; divergência de
gerenciador invalida a auditoria do grafo liberado.
