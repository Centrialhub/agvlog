# SSX Deno type correction — 2026-10-13

Base: 3e1cdd30900da5a1d3c9922cc5ff67d3e3dfc6e6. Task: ssx-deno-typefix-20261013; owner: CodexSsxDenoTypefix. This isolated correction has no integration or publication authority.

The official, hash-verified Deno 2.9.7 reproduced the frozen candidate's 33 diagnostics: insert-person 9, rule-violations 22, login 1, units 1. All ten configured entrypoints then passed Deno check and emitted bundles using qualified copied cache and unchanged frozen locks. The original runtime cache, lockfiles and source candidate were preserved.

Client annotations now infer from concrete factories instead of extracting the return type of the generic createClient declaration. This preserves the exact SDK default client contract actually instantiated by each caller; no schema regeneration, assertion or explicit any was added. The violations factory retains persistSession=false, autoRefreshToken=false, propagation of existing abort signals and the 10-second database deadline. This correction does not claim complete static validation of the database schema: existing SDK defaults and shared legacy declarations remain.

Login accepts a backoff date only from a string or number and ignores invalid/non-finite/structured values. Valid ISO and numeric cooldowns keep their response and retry_at; expiry, explicit force, authorization precedence and cached-token behavior are preserved. Structured JSON is no longer coerced by Date (for example, an array containing a future date).

Units adds a local DiscoveryAttemptResult with optional boolean discoveryComplete, covering recursive discovery, absent flags on other endpoint results and the consumer. The related three any casts and two result assertions were removed. Runtime discovery limits, failure propagation and completeness decisions are unchanged.

Local regressions: 152 unique cases passed across 12 existing focused suites, including 36 login cases (15 added). The first run passed 145 and could not start 7 rollback cases because the restricted harness omitted Git from PATH. After adding the known Git directory, only those 7 cases were repeated and all passed. This was a harness failure, not a skipped acceptance gate. No tests were removed or assertions weakened.

Additional gates passed: application TypeScript, lint for the changed test, Edge syntax, code-quality baseline and Supabase release contract. Runs used Node 22.23.2, one Vitest worker, synthetic clients/PGlite fixtures and an inherited read/network guard. Existing dependencies were reused through an ignored node_modules junction; no installation, update or Forge/Braces remediation occurred.

Evidence: C:/Users/Thomaz/Documents/Codex/2026-10-13/task/ssx-deno-evidence. Raw before/after logs, exact arguments, environment allowlist, source/lock hashes, QA receipts and final commit binding are retained externally. The final committed source will be checked and bundled again for the sealed handoff.

Limits: these results do not approve a production deployment, hosted CI, native Supabase/GoTrue, real SSX calls, runtime bundle parity with published functions or the driver's integrated acceptance flow. Dependency review for the qualified locks remains a publication gate. Independent review and coordinator freeze/composition remain separate steps. No migrations, infrastructure or production operations were performed.
