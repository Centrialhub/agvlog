# Operational audit requested by the user — 2026-09-14

New feature development is paused. Scope is the published module (last recorded Sites37, source be98fec6), not the local employee advance work. No claim that the module is fully operational.

## User-reported failures and evidence

| Journey | Evidence | Current action/status |
|---|---|---|
| Import bank statement | User reports failure. Metadata shows expected public RPCs and published v2 Edge branches, but this is not an execution proof. File format/error still requested. | Native agent investigating runtime/CORS; no root cause asserted yet. |
| Manual bank movement | Published BankReconciliation placed ReconciliationMovementEntry only under LegacyBankReconciliation, not default statements view. | Root moved entry to main header and permits choosing an account without prior statement selection. Existing canonical writer reused; no fake statement line.8 focused local tests passed16:45:21. Not published yet. |
| NF-e XML to payable | Published Payables handleSave catches upload failure then continues create/update; uploadSecureFile legacy path depends on absent scanner. Local XML extraction is separate. | Confirmed attachment failure/ambiguous success path; not proof of every XML parse failure. UI agent correcting success-on-failure, mapping complete attachment fix. |
| Delete financial record | Movement correction is deployed and readiness true, but labels say correction/invalidation. | Agent changed labels to Corrigir ou excluir registro / Excluir registro incorreto; existing evidence and guards preserved.10 tests passed. Specific affected page still requested. |
| Delete incorrectly created driver trip | No cancellation RPC found for dispatched trip. Draft deletion exists. Production FKs include restrictive dependencies and cascading events/stops. | Requires controlled cancellation path; no blanket DELETE or production deletion executed. |
| Driver settlement advances with bank account | User requires an Envios ao motorista tab and outgoing movement connected to selected company account. Production list_movements already supports driver_id filtering. | Bank agent reusing canonical movement form/list within settlement, with driver/company scoping, no duplicate settlement payment and no automatic bank match. |
| Closing/payroll rows missing | Loaders ignored query errors and showed empty data. | UI agent fixed error/loading/empty distinction and blocks mutations without verified data;3 tests passed. Not published yet. |

## Browser and telemetry limits

CUA failed twice before accessing browser session (trusted Node/sandbox kernel errors). Alternative browser CLI reached unauthenticated login. User was asked to log in to the separate test window; do not read profile credentials or create a fabricated identity. Authenticated browser actions remain unverified.

Read-only production application_error_events query for financial routes over5days returned no records. This does not prove requests succeeded: handled API errors may not reach exception telemetry. Cost-center policies and recorded_costs RPC definitions were inspected; no specific mismatch established from metadata alone.

## Preservation

Employee advance WIP migrations124237/124625/125548 and unfinished public boundary20260914191353 must not be included in an operational hotfix release. Same multi-tenant/driver exclusion and no-new-fiscal-document restrictions remain. User-authorized fixes to existing flows proceed; full acceptance requires reproducing the reported journeys in the published system.

## Integrated audit release 41

- Main audit commit b8f8456f. Isolated snapshot based on b59d031a plus the exact hashed allowlist finance-audit41-staging-manifest-2026-09-14.json.
- Discovered Sites40 was deployed by the cost-center task from the whole working tree. Preserved its seven cost-center sources/tests plus fiscal download UI and the preceding delivery-receipt changes. The task explicitly handed publication back to this owner.
- Excluded unfinished employee advance UI because its backend is not installed; restored those pages/hooks to committed baseline. This is not a certification of legacy advance payment behavior.
- Integrated isolated checks: 46 tests /12 files passed at17:01:29, typecheck exit0, build:check exit0 (4735modules,20.02s). Root additionally ran33 processing/recovery tests over5files at16:58:53, all passed.
- Includes manual entry on reconciliation main header, driver sends with account selector, explicit financial invalidation labels, loading/error states, safe upload diagnostics and XML upload-failure abort. Does not claim successful XML preservation or trip cancellation.
- Source Site commit76f3a20e249c987b256aa99d03398cbbce9db660. Version41 appgprj_6a958c7d22dc8191840efb545d976b79~appgver_9fc523acc244819192d4c1a48840a78c. Deployment appgdep_6aa853bd2db48191a2760ded6b8240a5 succeeded at20:06:41UTC, same production URL https://agvlog-preview-thomaz-20260831.veituma.chatgpt.site.
- Archive sha256 ab2907c2f1ac2557e94eccb89b81bd8c1a1a633c6046288835fef2ea95285b72,340files,9123840bytes. Packaging validated via current Sites0.1.62 helper with Git bash PATH. build-site wrapper failed due missing local npm shim; existing approved node build.mjs exited0.
- No production database mutation for this hotfix. Authenticated hosted acceptance still unverified. Candidate XML backend and controlled trip cancellation are being developed separately, not in this release.
