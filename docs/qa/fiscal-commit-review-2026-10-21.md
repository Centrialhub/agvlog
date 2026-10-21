# Revisão e homologação fiscal — 21/10/2026

**Candidato:** `af610a6c67d46640258f2a044044c7b1702bd198`, base `0da8bf35c624cd2032fb86633531a3cf13f43f3e`.
**Resultado da revisão original:** af610a6 reprovado no gate funcional local. Os achados abaixo motivaram a correção subsequente; ver revalidação ao final.
Worktree: `F:/AGVLOG/work/fiscal-service-failure-20261021`. Check do coordenador aprovado. Código do candidato preservado; apenas este relatório e regressões de revisão adicionados, sem novo commit.

Este parágrafo descreve a rodada original. Na rodada seguinte, Thomaz solicitou corrigir os achados usando `F:/fiscalhub/docs/submission-outcome-contract.md`.

## Achados

### P1 — Consulta e callback de não transmissão continuam bloqueados

`supabase/migrations/20261021122925_classify_confirmed_submission_failures.sql:7` e `supabase/functions/_shared/fiscal-submission-outcome.ts:7` exigem `success:false` como condição de não transmissão. No código atual do Hub, `hub_documents_get/index.ts:29` retorna `success:true`; `withDocumentOutcome` preserva esse campo. `buildDocumentPayload` em `_shared/hub/outbound.ts:6` não acrescenta `success`. Ambos fornecem os fatos terminais, `requiresReconciliation:false`, `submissionOutcome:not_submitted` e erro estruturado.

Se a resposta inicial se perde ou o espelhamento falha, esses canais não recuperam a operação. Reproduzido executando a função SQL do commit com ambos os envelopes: `confirmed:false`, `status:pending`, `dispatch_state:uncertain`. O emitente continua bloqueado. O webhook da AGV repassa o envelope e retorna 503 quando a confirmação falha, perpetuando as tentativas.

Correção necessária: alinhar a classificação entre emissão, GET/sync e callback, separando sucesso da consulta do resultado fiscal. Preservar os requisitos de atestado explícito, identidade, escopo, ausência de autorização contraditória e não reenvio automático. Não basta remover genericamente as proteções para qualquer 502.

Fontes do Hub consultadas somente para leitura em `F:/fiscalhub`: `_shared/hub/submissionOutcome.ts`, `_shared/hub/outbound.ts`, `_shared/hub/auth.ts`, `_shared/hub/documents.ts`, `hub_documents_get/index.ts` (todos sob `supabase/functions`). São arquivos locais, incluindo alterações em andamento; não comprovam publicação do Hub.

### P2 — Rejeição definitiva interrompe o lote como resultado incerto

O novo HTTP 422 de `fiscalOperationResponse` faz `hubFiscalClient.ts:191` lançar `HubFiscalOperationError`. A execução não chega à conversão para `DefinitiveCteIssueError` em `useIssueCTe.tsx:125`. O lote em `CteEmissionPreviewDialog.tsx:801` usa `isDefinitiveCteIssueError` e interrompe os itens seguintes para essa classe nova.

Reproduzido: erro com `terminal:true`, `requiresReconciliation:false`, código `FISCAL_DOCUMENT_REJECTED` é classificado como não definitivo. Correção necessária: integrar a classificação terminal ao consumidor do lote, preservando interrupção para resultado desconhecido. Não confundir continuar outros documentos com repetir automaticamente a emissão recusada.

### P2 — Sincronização terminal deixa a tela com cache anterior

`hub-fiscal-proxy/index.ts:462` agora responde 422/502 depois de persistir uma rejeição/falha terminal. O cliente lança erro, mas `useSyncCTe` (`useIssueCTe.tsx:147–159`) e `useResendCte` (`:252`) invalidam as consultas somente em `onSuccess`. Portanto a mudança persistida não aciona atualização dos monitores/faturamento por esses hooks; a tela pode continuar exibindo a pendência até outro refetch.

Confirmado por leitura do fluxo de controle; não homologado em navegador nesta rodada. Correção necessária: invalidar após resultado persistido, inclusive erro fiscal terminal, e testar o estado visível após a sincronização.

## Evidências e limites

- 77 testes anteriores passaram em 10 arquivos (contrato, SQL/PGlite, despacho, proxy, cliente, preflight, callbacks e serialização).
- Três regressões novas em `src/test/fiscalCommitReview.test.ts` falham: GET, callback e classificação de rejeição no lote. Os testes expressam o comportamento esperado e ficam vermelhos deliberadamente até a correção.
- Relatório da execução inicial: `F:/AGVLOG/checks/fiscal-af610a6-review-tests-20261021.json`. Nessa primeira execução, os dois novos casos SQL pararam no preflight por endereço incompleto da fixture; isso foi corrigido antes de confirmar o achado.
- Evidência válida das três regressões, após corrigir a fixture: `F:/AGVLOG/checks/fiscal-af610a6-review-regressions-20261021.json`.
- `git diff --check` e `tsc --noEmit -p tsconfig.app.json` (Node 22) passaram.
- Os testes SQL usam PGlite e fixtures; não equivalem à aplicação de todas as migrations em PostgreSQL nativo.
- Não foram executados PostgreSQL nativo, navegador autenticado nem emissão fiscal real nesta rodada. O gate funcional falhou antes de avançar à homologação integrada. Os gates históricos da base não aprovam este SHA.
- Nenhuma migration, Edge Function ou frontend foi publicado. Nenhuma operação fiscal de produção foi reenviada ou alterada nesta revisão.

## Critérios para retomar a homologação

1. Corrigir os achados e fazer as três regressões passarem, acrescentando testes dos hooks para atualização do cache.
2. Verificar o contrato efetivamente publicado do Hub nos três canais, com autorização própria para qualquer alteração remota.
3. Validar migration e permissões em PostgreSQL nativo isolado; executar os gates de aplicação no novo SHA.
4. Em ambiente isolado e interface autenticada, verificar encerramento da pendência, mensagem de erro, nova tentativa manual, rejeição de um item sem interrupção indevida do lote e manutenção do bloqueio em resultado desconhecido.
5. Integrar pela fila e homologar a árvore combinada antes de qualquer publicação autorizada.

## Correção solicitada e revalidação

O documento fornecido confirma o significado independente de `success` em consultas e o contrato aditivo de callback. A correção remove essa dependência tanto no SQL quanto na Edge, aceita fatos na raiz/documento, rejeita campos contraditórios e mantém atestado estruturado, identidade e ordenação. A migração `20261021124814_align_fiscal_submission_outcome_channels.sql` é aditiva e não repara registros produtivos.

`HubFiscalOperationError.definitive` agora mantém o comportamento do lote para rejeição ou não transmissão terminal confirmada. Erros sem confirmação continuam não definitivos. Sync e recuperação invalidam as consultas em `onSettled`; quatro testes com React Query real e DOM verificam que a tela troca provider_unknown por error/rejected após 502/422, mostrando o erro e sem nova chamada automática.

As três regressões originais passaram. A rodada de 12 arquivos passou com 92 testes, incluindo paridade SQL/Edge em sete formatos válidos/inválidos, despacho idempotente, liberação de fontes, rejeição, autorização, callbacks e consumidores. Evidência: `F:/AGVLOG/checks/fiscal-contract-corrected-20261021.json`.

Typecheck da aplicação, ESLint dos arquivos alterados, sintaxe Edge (111/111), ordenação/contrato de migrations (764 migrations, 50 funções) e diff-check passaram. Após ajustar as fixtures de recuperação para GET 200/success:true, os 22 testes afetados passaram novamente (`F:/AGVLOG/checks/fiscal-contract-get-recovery-20261021.json`). A validação permanece local em PGlite e DOM simulado; não é homologação em PostgreSQL nativo ou navegador autenticado contra backend real. Nenhum deploy foi realizado. O reparo produtivo do CT-e 424 é relatado pelo documento do Hub e não foi repetido por esta tarefa.
