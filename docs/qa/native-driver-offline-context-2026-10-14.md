# Native driver confirmed offline context — authorized local QA

Status: **APPLIED / LOCAL SYNTHETIC QA PASS**. Task `native-pwa-confirmed-context-fix-20261014`, owner `CodexNativePwaContext`; base `9496a02b07ba6521790350c0499ecec1c18ecb73`, tree `b4c1a9c4de4c4c5c9bd1ec3ee383f720d2c7128b`. Exactly six reserved paths. Final commit/tree and byte hashes are recorded in the external sealed HANDOFF.json after coordinator commit.

## Authorization and preservation

The original three-product-file write was refused by automatic approval review for insufficient explicit authorization of the persistent authentication/tenant fallback. The user specifically authorized this confirmed-context cache at 2026-10-14 13:37 UTC. The original tool command was irrecoverable from accessible public task records; no private sessions or secrets were read. Following the coordinator's explicit direction, the same six-path patch SHA256 `f932416ad41d77a7300ea819da1c17d803d406cae9e277aad6428345ceb413ad` was transparently submitted to normal approval review, approved, and applied by Git (exit 0). All six materialized files matched approved LF hashes; the checkout converted them to CRLF.

An exec-server transport interruption occurred before tests started; it produced no test receipt. Ownership was checked again before running QA. Sources, frozen candidates, shared runtime/cache/locks, SQL, Storage, SSX, production and infrastructure were not changed. No integration, publication or remote operations occurred.

## Contract and changes versus the draft

Only the live operational membership reader's private Error tag admits transport fallback: SDK status 0, empty code and a recognized failed-fetch TypeError. HTTP denial/error strings, portal failure after authoritative empty operational data, raw untagged rejected TypeError, abort, timeout and malformed data fail closed.

The proof is staged only after a successful live read and persisted only when the driver view and signed tenant/role selection settle without pending/blocked activation. It stores actor, active tenant/workspace, GoTrue session_id, driver role, original token/confirmation/expiry timestamps and minimal membership metadata. It stores no access token, refresh token, password, key or user_metadata. JWT decoding only binds local UI context; it is not cryptographic verification or backend authorization.

Expiry is the minimum of the original JWT exp, optional SDK expires_at and online confirmation plus seven days. Fallback and token refresh without new live proof never extend it. Compared with the sealed draft, the helper now also expires an already mounted fallback, rechecks when the page wakes or its storage changes, and the provider immediately hides invalid actor/workspace/tenant/session/role/expiry bindings before a pending membership response. The active tenant header is cleared as the old scope disappears. Successful authoritative reads retire fallback state. No server command is acknowledged by fallback.

Online denial, empty/revoked/malformed membership and downgrade clear confirmation. The existing Auth cleanup entry point clears it on logout/account replacement while preserving durable commands/PDF. The inherited explicit navigator.onLine=false membership-v1 branch remains preserved: this patch adds no new guarantees to that legacy route and never promotes its cache into the new proof. A revocation made while disconnected remains unknown until reconnect or original expiry; backend RPC/Edge checks remain authoritative.

## Executed local QA

- Approved draft: 5 suites, 95 tests passed.
- Expanded regressions before the adjustment: 54 tests, 49 passed / 5 failed as expected; mounted expiry and immediate workspace/session/Auth-role/expired-token replacement failures were preserved in RED-REGRESSIONS.json.
- Adjusted implementation: **11 suites / 131 tests / 0 failures / 0 skips**. Coverage includes navigator=true plus failed transport after provider restart, minimum/secret-free cache, SDK/token/TTL limits, invalid data, logout/account replacement, online denials, signed-context async isolation, activation deadlines, operational/expense offline mutations, durable outbox and PDF submission regressions.
- App TypeScript (no emit), ESLint of five changed TS/TSX files, quality baseline, lockfile and repository hygiene: **all five gates passed**, with commands/log hashes in GATES.json. No limits were raised, assertions weakened or failures skipped.

These use the real provider/reader/cache and synthetic SDK/session fixtures. Durable PDF markers and existing PDF submission tests establish local regression evidence; they do not replace the owner's actual preserved Native PDF readback. The coordinator must compose the successor from frozen 416b, freeze that exact SHA, and qualify real signed GoTrue plus offline/online browser reload/cold start and preserved expense/PDF. Existing 416b evidence remains attached to that SHA, not silently attributed to this successor. Android/iOS physical acceptance and hosted CI/release remain separate.
