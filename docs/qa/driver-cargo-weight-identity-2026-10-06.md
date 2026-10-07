# Driver cargo: weight precision and selected-trip identity

Scope: F06 and F07 on frozen review base `61adbbb997667396541244da147b224defb22e94` (tree `328f33f69c352720574b24deebaa9d19bde7faaf`). Task `driver-cargo-weight-identity-20261006`, owner `CodexCargo`. Production audit refers to `63278f7ef77dd1c4e0db7d9e7219ca48280ee18a`; its observations are not evidence that this candidate was exercised.

## Result

Initial API weight `7691.72607421875` becomes `7691.73` kg with an explicit original-to-rounded notice. Decimal half-up uses the received number's decimal string and BigInt quotient/remainder, including scientific notation. It does not use binary multiplication to round. Manual input with more than two decimals remains rejected before upload/mutation. Volumes, evidence requirements and fiscal source records are preserved.

Before acceptance, the selected URL trip's canonical linked loads and vehicle plate replace truncated UUID labels. A different active trip never supplies labels. Every canonical load is retained and matched by ID. Missing labels/plate, vehicle mismatch, identity fetch in progress or failure disable acceptance, with an explicit refresh action. Tenant, actor, driver and trip form the identity query key; the session remount clears drafts on scope changes. A stale session cannot begin a cargo mutation. Query abort/response validation protect late or mismatched identity responses.

The existing operational snapshot preserves unrelated fields, including fiscal delivery snapshots. Complete identity is saved with cargo; partial/error responses cannot overwrite valid offline labels. Offline display uses the same tenant/actor/trip/driver/vehicle snapshot and keeps commands disabled. Old truncated-ID cache labels are treated as unavailable.

## Decimal cases for the server workstream

| Input | Initial value | Rounded notice |
| --- | --- | --- |
| 7691.72607421875 | 7691.73 | yes |
| 1.005 | 1.01 | yes |
| 2.675 | 2.68 | yes |
| 9.995 | 10.00 | yes |
| 1.0049999999999997 | 1.00 | yes |
| 12.34 / integer / zero | two-place string | no |
| 1e-7 / Number.MIN_VALUE | 0.00 | yes |
| 90071992547409.9 | 90071992547409.90 | no |

Reject nonfinite/negative/runtime non-number values and cents exceeding MAX_SAFE_INTEGER. Reject a cent lost by the numeric JSON representation: reconstruct decimal cents from `String(Number(value))`, rather than multiplying the payload by100. `90071992547409.91` loses its cent in Number and is rejected. The lower-bound fixture uses `1.0049999999999997`: literal `1.0049999999999999` equals1.005 as a JS Number and cannot represent the intended below-half case. These JS representation limits do not replace authorized server business limits.

## Files and disjoint ownership

Only eight reserved files are included:

- `src/pages/driver/DriverCargoCustody.tsx`
- `src/lib/driver/cargoWeightKg.ts`
- `src/lib/driver/cargoTripIdentity.ts`
- `src/hooks/useDriverCargoTripIdentity.ts`
- `src/test/cargoWeightKg.test.ts`
- `src/test/cargoTripIdentity.test.ts`
- `src/test/DriverCargoCustodyIdentityWeight.test.tsx`
- `docs/qa/driver-cargo-weight-identity-2026-10-06.md`

No SQL or shared helper/schema changes are included. F05/F08/F09/F10/F11, PWA, chat, AGENTS and coordinator shared state belong to separate fronts.

## Local verification

Node22.23.2; offline dependency installation in this worktree. Seven focused files cover weight boundaries, canonical multiple-load identity, selected versus active trip, scope switches, late responses, acceptance success/missing/error/recovery, snapshot preservation and offline reopening; existing cargo divergence, exact collection and trip-contract regressions are included. Final count/result is recorded in the external `cargo-evidence/checks.json` and `focused-tests.log`. TypeScript checks the full tsconfig.app.json; ESLint covers the seven changed TS/TSX files with zero allowed warnings. Coordinator check precedes edits/tests.

All are local unit/component tests using synthetic data and mocks for transport, hooks, durable storage and upload. They do not execute RLS/GoTrue, scanner, native RPC, shared replica, publication or fiscal emissions. Local review additionally found and fixed acceptance after a failed identity refetch and valid offline labels being overwritten by partial live results. Assertions wait for React Query observer notification before evaluating the rendered failed/refreshed state.

## Integrated retest and remaining dependencies

1. On the combined frozen SHA, authenticate a driver and open a URL trip different from the active trip, with at least two canonical loads; check each load label, selected vehicle plate, accept payload and denied cross-tenant/other-driver access.
2. Exercise missing number/plate, mismatched vehicle, pending/failed refresh after an initial success and recovery. Acceptance must stay disabled until complete current identity returns.
3. Confer the audit weight, inspect the explicit notice and two-decimal payload; type a third decimal manually and verify rejection before upload/mutation. Server workstream must align precision and validate native RPC behavior before declaring F06 fully closed.
4. Cache the identified trip, reopen offline, switch actor/tenant/driver, and resolve an old delayed response. Labels must remain scoped, drafts must reset, unrelated snapshot fields must survive and offline commands must remain blocked.
5. Integration owns formal freeze/combined candidate and reviewer owns native retest. No push, enqueue, integration or deploy is authorized for this task.

External evidence: `C:/Users/Thomaz/Documents/Codex/2026-10-06/task/cargo-evidence/`; own Main Vault note `05 Sessoes/Correção AGVLOG/2026-10-06-Codex-F06-F07-implementacao.md`. Commit SHA, tree, bundle and file hashes are supplied by the handoff after the coordinated commit.
