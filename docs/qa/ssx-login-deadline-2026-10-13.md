# SSX login transport deadline — isolated candidate, 2026-10-13

Base: ca38412768d00450886eba6e84a995bee3411793. Separate coordinator task ssx-login-deadline-20261013/CodexSsxDeadline; integration/local remains 50b6fe92a5501aac9588eec7b88d47dc3a21cf38.

Verified offline: the original Tracking login (ssx-login/index.ts:165–168) and opted-in Administration login (ssx-utils.ts:234–238) await fetch headers and the response body without a deadline. Existing Tracking backoff is reached only when that operation rejects. Four synthetic stall counterproofs fail on the unchanged callers; five existing behavior controls pass. No real provider request or production failure is asserted.

Change: one shared AbortController timer covers headers and body, is cleared on success or error, and routes timeout to each caller's existing error behavior. Tracking keeps degraded status, login backoff and 502; Administration returns SSX_ADMIN_LOGIN_NETWORK_FAILED without storing a token. Authorization, Administration opt-in, query parameters, provider TTL, encrypted cache, migrations and frontend are preserved.

Timeout settings: positive numeric values (including numeric strings) are rounded down, with a 1 ms minimum and explicit 120,000 ms transport ceiling. Invalid, missing, zero or negative settings use the existing 30,000 ms default. The two-minute ceiling prevents oversized JavaScript timers from overflowing or disabling a useful bound. This is a transport ceiling, not a deadline for Auth, capability, database or cache RPC operations.

Acceptance: synthetic stalls at headers and body settle and abort at the configured deadline; no late token write; normal success, HTTP 401, cached token, authentication and role rejection, mandatory Administration opt-in and encrypted Administration success remain valid. Related SSX runtime/contract tests, typecheck, lint, Edge syntax, quality baseline and release contract will be recorded externally against the exact candidate SHA.

Limits: fake timers and clients verify the code's cancellation contract. The actual Deno/Fetch/GoTrue/Postgres/browser chain, provider-specific abort behavior, concurrent account settings updates, integration/local composition and hosted CI remain pending. This patch does not close D-A7, restore completeness for LEG1815, or authorize a fourth real SSX query. No Forge/Braces work, partial database baseline, Native stack, cleanup, composition or publication is performed.
