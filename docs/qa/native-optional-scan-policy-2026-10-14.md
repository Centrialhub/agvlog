# PATCH2: upload without required antivirus — authorized local QA

Task `native-optional-scan-policy-20261014`, owner `CodexNoScannerPolicy`, base `416b3c6eea32cda80b0ad60ff6cc9fc42f70a56c`. Exactly18reserved paths. Final commit/tree, checkout/GitLF hashes, approved source pin and receipts are in the external sealed HANDOFF.json after coordinator commit. No integration/publication/production/configuration/shared runtime changes occurred.

## Explicit decision and behavior

The user specifically authorized withdrawal of required antivirus at2026-10-14 14:09UTC while retaining format/size, authentication, tenant/workspace authorization, private Storage, hash/idempotency and local files until server ACK. Scanner contracting is suspended. The gateway no longer reads scanner configuration or invokes a scanner, even if obsolete scanner settings are present. It never manufactures clean:true/scanned:true for new files.

New immutable objects carry server-written `scanned:false`, `scan_status:not_performed`, `scan_policy:patch2-no-scanner-v1`. Canonical expense helper still checks tenant/actor/request/source/path/hash/size/MIME; it accepts that exact stamp or an actual stored historical positive record. It returns existing provenance unchanged. Null/string booleans, inconsistent status/policy and wrong identity/hash/bytes are refused. Browser writes to this reserved Storage path remain denied. Public DTOs/types/UI are unchanged; no additional format is enabled or labeled safe.

Both caller inspections and post-Storage confirmation remain. Expense creation/ACK and replay stay separate from upload; durable request/PDF remains until a valid creation ACK. Upload is never overwritten. The inherited retry policies remain: POD24attempts/5failures with durable backoff5–120s; expense one automatic round per mounted pending-ID set with reconnect/remount/manual resumption, no numeric uploadFailure cap added. Do not promise eventual upload solely because the network returns when another server/storage failure persists.

## SQL and reviewed42

CLI2.116.0 generated `20261014141521_remove_required_malware_scan_preserve_receipt_provenance.sql` in an external local artifact directory before its exact path was reserved. The new forward pins prior receipt helper bodyMD5LF `2c350513ca9546c08e8ce2795d5db99b` (also matched by the parent's read-only production metadata) and new bodyMD5 `763e82a37b0b6cb4554ba2aa28c07e53`; owner postgres, stable/invoker, empty search_path, original ACL/config/parallel/leakproof/return type are preserved. No data/backfill/Auth/Storage/RLS/grant mutation is in this migration. Existing migrations and candidate/follow-up manifests remain unchanged.

The supplementary manifest appends this one exact LF hash. The execution helper requires42closed forwards, preserves the reviewed stop-helper hash as the penultimate input and binds the new final forward by exact version/name/SHA. The read-only catalog contract also checks the new function body/owner/invoker/ACL. Missing/duplicate/tampered inputs remain refused. Nothing is repaired into migration history without actual DDL; this child has applied SQL only to disposable PGlite fixtures.

## Files, formats and limitations preserved

Legacy gateway supports images/proofPDF/financialXML and original OFX/CSV/XLS/XLSX statements according to existing kind/path/role checks. Financial quarantine already works without AV: OFX/CSV/XLSX become bounded inert JSON, JPEG/PNG reencoded derivatives; PDF/XLS stay quarantined/unusable. No quarantine status, sanitization threshold, byte/MIME/format/size guard, XML parser, bucket/public flag or signed-URL contract is relaxed here. Browser generic XML checks are prefix-based and browser parsers lack an explicit full-document DTD/ENTITY refusal; that separately documented limitation is not represented as an AV guarantee. Dedicated payable/fiscal XML parsers reject full-document DTD/entities and remain intact.

## Rehearsals and compatibility

The original2026-08-30 containment/resume recipes are preserved byte-for-byte. They pin pre-MFA functions and therefore must refuse the current graph. New2026-10-14 recipes pin45functions,18triggers and24constraints from the parent's read-only Native318f catalog SHA256 `bf09e91b7a2a5a9eb7d6c8e34f37f20b222f26096f1bd66e6d7ebaa7c2a4c4aa`, replacing only the receipt-helper fingerprint with its reviewed new body. They stop both public/private active creation/upload entry points, retain all rows/files/uncertain requests, and restore only authenticated caller-JWT grants; no service-role grant or legacy API is restored. They never restore an old helper or relabel not_performed objects.

**These new recipes are prepared, not positively executed against Native42 by this child.** A local counterexample proves they reject the older partial fixture. The parent must rehearse contain/resume on a separately coordinated full42clone and verify private/direct routes are contained and that resumption preserves the same data/hash/UUID. Do not run them on the currently preserved Native instance or production without coordination. An old secure-upload Edge is not automatically compatible with new not_performed receipts; retain a compatible Edge or prepare a compatible return. SQL/Storage/data stay preserved on rollback.

## Local evidence

- First associated run74:46passed/28failed; preserved. It exposed a missed old deps.scan line (corrected with zero-invocation assertion), fixture JWT/status expectations and obsolete pre-MFA recipe assumptions. No assertions were weakened or failures skipped.
- Repaired6files:74/74passed; final2changed files34/34passed including one new recipe counterexample. Selected final corpus is **6files/75unique tests/0failures/0skips**; unchanged green suites were not repeated. Includes actual handler+SDK closed synthetic HTTP, provenance metadata header, legacy ACK, malformed/null/string flags, byte/actor/tenant/source mismatch, no browser forge through RLS, owner/ACL checks, MFA authorization between inspections, browser file+SQL expense binding and replay.
- App TypeScript, changed ESLint, quality baseline, release, reviewed baseline inventory42, Edge syntax, full pipeline, lockfile and repository hygiene passed; TypeScript's first3test-only diagnostics and final correction are preserved separately. Pipeline214tests:213pass/1existing Windows skip/0fail. No limits were raised.

Validation here uses synthetic HTTP and disposable in-memory SQL, not hosted scanner/provider acceptance. The parent composes with the frozen PWA source and qualifies the exact successor in Native without scanner settings: offline/reload/replay/cross-company, same expense/PDF/hash/UUID, full42forward/catalog plus new recipe rehearsal. Prior318f/416b results retain their original SHA. Physical-device testing was waived by the user's explicit later decision, not executed. Hosted CI/staging and publication remain the parent's separate gates.
