# Gravação operacional offline antes da reconexão — 2026-10-14

Task `native-offline-queue-fix-20261014`, owner `CodexNativeOfflineQueue`, checkout `F:/AGVLOG/work/native-offline-queue-fix-20261014`. Base congelada: `b9ad8dab41d0cdebee60d6b96c8903584a68f68d` (tree `48f20a0ebb26db40859f23d38b516f3c72d0862a`). Fork-review e ownership conferidos pelo coordenador; commit/freeze pertencem à raiz. Não houve integração ou publicação desta task.

O Native da base registrou `navigator.onLine=false`, outbox vazia, zero RPC e botão pendente ao tentar almoço. A reconexão retomou a mutação em memória e persistiu um evento no servidor. Evidência preservada: `C:/Users/Thomaz/Documents/Codex/2026-10-01/task/native-operational-handoff-20261014/NATIVE-JOURNEY-OFFLINE-DIAGNOSTIC.json`.

## Causa e correção mínima

O modo padrão `online` de `useMutation` pausa antes de chamar `mutationFn`. Com isso, `useDriverOperationalOffline.submit` não chega a gravar a fila quando offline. O serviço existente já aguarda `outbox.put` antes de qualquer transporte. A [documentação oficial de modos de rede do TanStack Query](https://tanstack.com/query/latest/docs/framework/react/guides/network-mode) confirma essa distinção.

Acrescentados somente comentário e `networkMode: 'always'` em três mutações que começam pela gravação local:

- `DriverJourney.addEvent`;
- `DriverChecklistSection.save`;
- `DriverIssues.createIssue`.

Delta de produto: seis linhas adicionadas. Não mudou modo global, hook, serviço, IndexedDB, schema, RPC, payload, UUID, refresh Auth, guards de sessão/empresa ou permissões. `DriverStops.updateStop` já possuía essa configuração e foi preservado. Os demais arquivos novos são regressões, fixture e esta nota.

## Verificação realizada

Artefatos exclusivos: `C:/Users/Thomaz/Documents/Codex/2026-10-01/task/native-offline-queue-fix-20261014/`.

| Gate | Resultado | Evidência |
| --- | --- | --- |
| Baseline com os cinco novos casos | 5 falhas; 16 testes associados passam | `RED-BASELINE-UNIT-V2.json`, `RED-BASELINE-UNIT-V2-vitest-results.json` |
| Vitest final — quatro suítes | 21/21 PASS, zero skips/falhas/warnings React | `FINAL-UNIT.json`, `FINAL-UNIT-vitest-results.json` |
| Chromium / IndexedDB final | 3/3 PASS | `FINAL-BROWSER.json`, `FINAL-BROWSER-playwright-results.json`, `BROWSER-PROOF-{journey,checklist,occurrence}.json` |
| TypeScript aplicação final | PASS | `FINAL-TYPECHECK.json` |
| Lint dos arquivos alterados | PASS, zero erros/warnings | `FINAL-LINT.json` |
| Diff e limites relevantes | `git diff --check` PASS; DriverIssues 476 ≤ 481 | Verificação no handoff selado |

Os cinco casos novos usam QueryClient, componente, hook e serviço reais. Somente o adaptador de storage nesse nível é em memória e o transporte é sintético. Confirmam gravação antes da reconexão, mutação concluída sem pausa, retenção no escopo original após troca de ator/empresa, recuperação com UUID/payload originais uma vez, aviso de sucesso somente após confirmação do storage e ausência de falso sucesso quando storage falha.

O complemento Chromium usa o IndexedDB real e as três UIs reais. Para cada jornada, checklist e ocorrência, verificou: linha gravada antes da reconexão; zero transporte; sucesso sem pausa; reload e reabertura da mesma linha quando não existe mais a mutação em memória; zero replay por ator ou empresa diferente; replay único com UUID/payload originais no contexto correto; limpeza somente após receipt válido; segunda recuperação sem duplicação. Os attachments registram `before`, `reopened` e `confirmed`. Rotas externas foram bloqueadas e nenhuma tentativa externa ocorreu.

No browser, o estado offline de `navigator`/onlineManager é controlado pela fixture; assets continuam acessíveis para reload. Isso prova durabilidade IndexedDB independentemente da qualificação PWA, que pertence a outra task. Não declara passagem do reload da PWA em rede fisicamente desconectada.

## Execução qualificada e limites

Node absoluto `C:/Users/Thomaz/AppData/Local/npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe`, versão 22.23.2, SHA256 `0d0f5e39f9f3d9587bc19f73eab3c2c9c4903fd02d6dbf9c853dd81b3d95fad4`. Dependências copiadas por leitura para esta task, sem reparse points ou cache compartilhado, a partir de `patch2-native-candidate-20261013/node_modules`. Locks byte-iguais, SHA256 `1b1bbf3972ac1ab07701129db51724a2ca7eb3bc918f9a72081e50c8e65e788d`. Vitest 4.1.11, Vite 6.4.3, React Query 5.83.0, Playwright 1.62.1 e SDK Supabase 2.108.2. EnvDir vazio, ambiente de processo mínimo, configs/caches/outputs exclusivos; sem leitura de `.env` ou `.npmrc` pessoal.

Chromium full não iniciou (`spawn UNKNOWN`) e a evidência foi preservada. A alternativa existente `chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe` passou, SHA256 `ce4635cd0e5dc0e21494542a701f347e91c1f1d821970578d97ed8df4ced50ef`. A primeira configuração de Vitest apontava para entrypoint inexistente do plugin; corrigido após consulta do pacote, preservando recibo. Ajustes posteriores ficaram na fixture: tipagem de seletor, espera por ações React e separação do probe em arquivo próprio para passar lint sem alterar regra.

Comandos finais: Node qualificado executando `native-offline-queue-fix-20261014/run-gate.mjs unit FINAL-UNIT`, `browser FINAL-BROWSER`, `lint FINAL-LINT` e `typecheck FINAL-TYPECHECK`. Os recibos incluem argumentos, UTC, outputs, versões e hashes dos arquivos de código testados.

Sem WSL, containers, banco, runtime Native, contas reais, SSX, produção ou mudança de checkouts congelados/integration. Este gate usa transporte sintético e não aprova persistência Postgres/Edge nem semântica do receipt no backend. A raiz deverá compor os deltas e retestar jornada, checklist e ocorrência em rede offline real no mesmo SHA combinado: fila antes de reconectar/reabrir e um único efeito persistido após recuperar, incluindo isolamento ator/empresa. Commit/freeze e essa prova Native continuam com o coordenador.
