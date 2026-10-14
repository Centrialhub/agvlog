# Pending explícito na edição do vínculo de motorista — 2026-10-13

Sucessor coordenado `driver-link-strict-pending-20261013`, owner `CodexDriverStrictPending`, base congelada `a5bd4c713670f7708bd1ed52b96d538b9f29d8c0` / tree `bbaf3a464835a51398dbaeea428e1c45c9bd076f`. Integração permanece `50b6fe92a5501aac9588eec7b88d47dc3a21cf38`; pin publicado `df6dfd513098ff8967256ae9a2bbad8118fa35cd` não foi observado novamente em produção.

## Mudança e mecanismo

Exatamente dois predicados de `src/pages/Drivers.tsx` passam a exigir `command_pending === false`: disponibilidade do seletor de vínculo legado e revalidação imediatamente antes da alteração explícita. A revalidação recusa `command_pending !== false`. Ausência/null deixam de equivaler a ausência confirmada de comando pendente. Demais payloads, escopo tenant, CAS e controles de cancelamento/contexto permanecem iguais.

A lacuna foi reproduzida com respostas V3 sintéticas incompletas sobre a5bd4c71: quatro falhas (missing/null na inspeção inicial e na revalidação), com seletor habilitado e chamada UPDATE no mock. O produtor atual retorna boolean explícito; isto é hardening defensivo, não prova de defeito normal do handler nem diagnóstico adicional sobre o incidente produtivo original.

## Evidência independente e reprodução

Insumos do parecer em `C:/Users/Thomaz/Documents/Codex/2026-10-01/task-2/driver-native-ui-a5bd4c71-review-20261013`, copiados para `C:/Users/Thomaz/Documents/Codex/2026-10-12/task/strict-pending/inputs`:
- Seal SHA256 `4a2fd79e7730a9b43736e70d4e2975ec16a19d706f55f5c4065369784de66a17`.
- Proposta e página final SHA256 `ffda17355312874bfbac59dd6b2d5acc0e7d9c7295a6c1831db1e300519978b5`, byte-idênticas.
- Onze contraprovas preservadas em `src/test/independentNativeLinkUi.test.tsx`. Única adaptação: remover import e gravação de diagnóstico no filesystem, sem modificar assertions. Original preservado nos inputs.

Execução própria em **Node v22.16.0** (requisito do repo `>=22 <23`; parecer anterior usou v22.23.2):
- Baseline: **7 PASS / 4 FAIL / 0 SKIP**, `results/baseline-11-node22.*`.
- Corrigido: **63 PASS / 0 FAIL / 0 SKIP**, `results/final-63-node22.*` (33 entrada + 18 UI + 1 witness + 11 independentes).
- Lint `--max-warnings 0` e TypeScript direcionado: resultados finais `results/*-verified-node22.*`. A primeira execução encontrou somente import de diagnóstico sem uso; logs mantidos e import removido.
- jsdom, página real, adaptadores externos simulados, um worker, envDir vazio, env sintético e bloqueio de rede. O texto “immutable snapshot” no recibo baseline é herdado do harness: o alvo real foi este sucessor coordenado com lógica produtiva ainda idêntica à base. Argumentos/configuração identificam o alvo exato.

## Limites e handoff

Sem alteração de SQL/Edge/Auth/RLS/roles/credenciais/dados. Proposta SQL herdada `docs/qa/driver-shared-lifecycle-link-protection-proposal.sql` byte-idêntica; guarda de banco ainda é dependência separada. Não cria migration, não tenta CLI Supabase, não toca Native/WSL/Docker/serviços. Nenhum motorista real foi excluído ou desvinculado. Cadastro e conta de acesso continuam separados. A UI não substitui autorização/guardas de banco nem elimina corridas com API direta. Native, gates combinados e publicação não aprovados por estes testes. Build não repetido para os dois predicados; o build aprovado pelo revisor pertence à base a5bd4c71.

Commit somente pelo coordenador, sem enqueue/integrate/push. Handoff externo `DRIVER-STRICT-PENDING-HANDOFF-20261013.json` fixa SHA/tree, arquivos e hashes das evidências. Freeze formal fica a cargo do integrador; nenhum novo ajuste após o handoff.
