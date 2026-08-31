# CT-e batch incident — 2026-08-31

## Findings and containment

The billing preview dispatched up to five CT-e concurrently. The provider returned duplicate-number responses whose referenced authorized keys belonged to different source invoices, along with provider_unknown outcomes. A duplicate key in an error is not proof that the failed source invoice was authorized.

- Serialize CT-e submissions in the preview and stop the batch at its first error.
- Enforce one unresolved durable CT-e operation per tenant/emitter/environment in the database, under the existing transaction advisory lock. Other tabs and old clients cannot bypass this guard.
- Keep existing-operation recovery GET-only. Never expire uncertainty into permission to resend.
- Accept identity-bound explicit rejected receipts carried in HTTP error envelopes, while preserving provider_unknown as uncertain.
- Exclude durable in-flight/uncertain sources from both billing lists, including cases without catalog rows. Unsent preparations and definitively rejected invoices remain available. Homologation reservations do not consume production availability.
- Refresh billing availability after both successful and failed CT-e attempts and after reconciliation.

## Validation

- Live migration applied and emitter guard verified without inserting another operation or issuing a document.
- Existing operations consulted through the status poll only; no new fiscal emission was initiated during this repair.
- 85 focused tests passed, including actual PostgreSQL-compatible locking/claim logic, no second HTTP dispatch, rejected and unknown receipts, tenant/environment isolation, pagination and billing-list lifecycle.
- Full suite: 2799/2800 passed in the initial run; one unrelated expense MFA fixture exceeded its 5-second timeout under concurrency. Its entire file passed in the focused rerun with two workers.
- TypeScript, lint on touched implementation/tests, production build, bundle budget and public-artifact checks passed.

## Remaining external dependencies

Provider_unknown operations require a definitive result from the Fiscal Hub/provider before another CT-e can be sent by the same emitter. The current user-specific reconciliation inventory is maintained outside tracked source, to avoid checking provider identifiers into the repository. NF 448906 has no recipient state registration in the matched customer record; correct authoritative registration data is needed before retrying that rejected invoice. Do not invent IE values or copy authorization identifiers from other invoices.
