# Published statement-import audit — 2026-09-14

Scope: published Sites37 source `be98fec693d4b0858744d78cd46db16c890f72db`, production project qcvnsdrbcchaxvawcngk. Production work was SELECT, Edge source retrieval and OPTIONS only. No financial writes, uploads, migrations or fabricated authentication.

## Runtime evidence

- Both deployed functions exist: secure-upload version 25 and finance-statement-verify version 6. Retrieved source contains the v2 artifact workflow and verifier. New statement requests use this workflow; the absent legacy scanner is not invoked in this branch.
- OPTIONS requests from the actual published Sites origin returned HTTP 200 for both functions. Access-Control-Allow-Origin matched exactly and x-agvlog-tenant-id was allowed.
- Eight public artifact/import RPCs exist with matching named arguments. Caller RPCs grant authenticated; prepare/finalize/record verification grant service_role. No missing RPC or privilege mismatch was found in this boundary.
- Published activeTenantFetch adds the tenant header to Edge requests. The Edge validates header and signed active_tenant_id. Downstream database request_tenant_id accepts the signed claim without a forwarded header.
- The broader conservative module graph of Receivables/Payables/Expenses contained 93 static RPC callsites: none missing or denying authenticated EXECUTE; 90 statically known argument objects matched actual catalog names/defaults. Three dynamic argument objects were not statically proved. This is metadata evidence, not a successful browser transaction.
- Supabase log retrieval is not exposed by the available tools. No authenticated browser session was available. The user's failing file format and exact server response remain unknown; nenhum formato tem sucesso E2E publicado reivindicado por esta auditoria.

## Concrete findings and bounded patch

1. uploadArtifactClient discarded every FunctionsHttpError response, replacing it with the same generic message. The patch retains only an allowlisted public error code and HTTP status, never raw messages, response bodies, tokens or file data. Non-JSON/consumed responses and network failures still preserve recovery.
2. Uma revisão posterior encontrou que o pipeline já lê, mapeia, preserva e verifica XLS/XLSX, mas o botão `Preparar prévia` continuava limitado por regex a OFX/CSV e o texto ainda dizia que Excel não importava lançamentos. O botão agora aceita `.xls` e `.xlsx`, e a cópia distingue Excel importável de PDF/imagem preservados somente como origem. Fórmulas em planilhas continuam rejeitadas para não certificar valores calculados como evidência bancária original.
3. Manual movement entry was nested under the historical reconciliation tab in published source. Root owns the main-screen entry correction.

## Verification and allowlist

Validação atual da correção Excel: 4 arquivos/24 testes aprovados — `statementImportDialog` (7), `financeStatementWorkbook` (4), `statementOriginalGateway` (4) e `statementImportWorkflow` (9). O caso sem mocks cria um XLSX em memória e comprova leitura, mapeamento, período, totais, hash e caminho `.xlsx` preservado. ESLint, typecheck completo e `git diff --check` passaram. Esses testes validam a correção local, não uma importação autenticada publicada.

- src/lib/financial/uploadArtifactError.ts
- src/lib/financial/uploadArtifactClient.ts
- src/components/financial/StatementImportDialog.tsx
- src/test/statementImportDialog.test.tsx
- src/test/financeStatementWorkbook.test.ts
- src/test/uploadArtifactError.test.ts
- docs/qa/finance-statement-import-runtime-audit-2026-09-14.md

Nenhum parser novo ou relaxamento de validação foi adicionado; a correção habilita o caminho de workbook já existente e testado. Ainda não foi publicada.
