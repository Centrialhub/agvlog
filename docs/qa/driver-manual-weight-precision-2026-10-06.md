# F06 P2: preserve manual weight through numeric JSON

Task `driver-manual-weight-precision-20261006`, owner `CodexCargo`. Frozen base `5f889756230acd38dab5f9d20ff89b0d51575130`, tree `499fe66a5b56d66d28ec7d5a639c4a9a1493128a`, source `F:/AGVLOG/work/driver-ssx-combined-20261006`. Four explicit paths reserved through fork-review; inherited AGENTS remains unchanged. Source, served replica, reviewer services/data and other fronts are preserved.

## Problem and correction

Native review's `manual-weight-results.json` showed input `90071992547409.91` becoming `90071992547409.9` before reaching the server. The source normalizer receives a Number and cannot recover the discarded digit. The ordinary source case `7691.72607421875 -> 7691.73` was reported passing UI/native command; this followup addresses only manual string conversion.

The manual weight parser retains the input string until it compares its exact decimal cents with the decimal cents of `JSON.stringify(Number(normalized))`. BigInt coefficients, decimal scale and exponent support make this comparison exact. Reject a mismatch or a nonzero fraction smaller than a cent with a clear precision error before upload/mutation. Do not round manual input. The existing nonnegative/two-decimal grammar, comma normalization, pallets, volume parser, collection validation and numeric command shape remain compatible.

No commercial maximum is introduced: representable `.90` and `.92`, large exact integers and numeric JSON exponent notation remain accepted by the parser. A parser acceptance makes no statement about business limits or server authorization. Nonfinite Number values keep the existing invalid-value rejection. Source-weight normalization/explicit rounding is unchanged. No SQL is necessary to stop this pre-transport loss; no database or fiscal artifacts are changed.

## Local evidence

Before changing the parser, the five regression cases failed against its original5f version with a valid synthetic RPC acknowledgement: the command resolved instead of rejecting. This is retained in `manual-weight-evidence/reproduction-before.log`. After correction, tests verify lost fractional/whole digits are rejected before an RPC call; normal values, comma/zero padding, zero, exact cent limits and scientific JSON serialize without decimal loss; existing third-decimal/syntax rejection, volumes and initial half-up normalization stay compatible.

Component tests preserve the raw input string and verify precision errors before any upload or cargo mutation for `.91` and the large fractional case. Positive `.90`/`.92` cases complete evidence requirements and retain the correct weight in the confirmation command. Tests exercise the actual `updateDriverTripCargo` adapter with a synthetic RPC transport, checking action, tenant, trip, requestId and serialized load weight. They do not execute a native RPC, RLS, scanner, GoTrue or the shared replica.

Eight focused test files, full TypeScript `tsconfig.app.json`, ESLint on the three changed TS/TSX files with max-warnings0 and coordinator/diff checks are recorded with timestamps and exit codes in `manual-weight-evidence/checks.json`. Final result/count, commit/tree, bundle/patch and hashes are supplied by the external handoff after the coordinated clean commit.

## Delta ownership

- `src/lib/driver/tripCargoConfirmation.ts`
- `src/test/tripCargoManualWeightPrecision.test.ts`
- `src/test/DriverCargoCustodyIdentityWeight.test.tsx`
- `docs/qa/driver-manual-weight-precision-2026-10-06.md`

## Retest

On the combined frozen SHA with the assigned driver, enter `90071992547409.91` (and comma form where the browser supports it). Require explicit precision rejection before upload or command; the server must receive no rounded substitute. Repeat with `9999999999999999.99` and an unrepresentable integer. Verify usual `7691.73`, zero and representable `.90`/`.92` are serialized unchanged, subject to the existing server's business contract. Recheck initial explicit `7691.72607421875 -> 7691.73` and manual third-decimal rejection. Integration owns combined tree/freeze; reviewer owns native tests. No push/enqueue/integration/deploy is performed by this task.

Source evidence: `C:/Users/Thomaz/Documents/Codex/2026-10-01/task-3/subagents-5f889756/driver/manual-weight-results.json` (pure exact-source VM evaluation). Our local evidence: `C:/Users/Thomaz/Documents/Codex/2026-10-06/task/manual-weight-evidence/`. Own Vault session note records decisions and delivery without modifying the common index.
