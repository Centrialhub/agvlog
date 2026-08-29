# Database baseline

The immutable schema snapshot is represented by
`migrations/20260824224152_baseline.sql`. Ordered forward migrations in the same
directory are part of the active repository contract and must be applied after
the snapshot in a new environment. A populated production project must use only
the reviewed incremental migrations that are not already present in its ledger.

Baseline SHA-256:
`9A8FB331632F4BD29C89C64072E3F81587A9D428D80DE12248B77C6193113305`.

The PostgreSQL 17 baseline contains:

- 186 public tables, all with RLS enabled;
- 273 public functions;
- 691 constraints and 491 standalone indexes;
- 465 public/Storage policies and 70 table triggers;
- four `security_invoker` views, three Storage buckets, nine Realtime members,
  one RLS-enforcement event trigger, and owned sequence metadata.

Business rows and historical data transformations are intentionally absent.
Environment-specific cron jobs are configured separately through
`bootstrap/cron_jobs.sql`; credentials, project URL, and tenant ID are read from
Vault and are not embedded in migrations.

## Frontend and Data API contract

The baseline is hardened for browser use:

- `anon` has no grants on application relations;
- `authenticated` has ordinary CRUD subject to RLS, but not `TRUNCATE`,
  `REFERENCES`, `TRIGGER`, or `MAINTAIN`;
- encrypted credentials, provider hashes/tokens, and tracker passwords are not
  browser-readable;
- backend-only credential columns are also not browser-writable;
- `service_role` retains the backend access required by Edge Functions;
- all browser RPC and relation/bucket names referenced by browser
  and Edge code are checked against the baseline by
  `src/test/supabaseBaselineContract.test.ts`;
- internal `SECURITY DEFINER` helpers are explicitly removed from the browser RPC
  surface, while every browser RPC is explicitly granted;
- every tenant-scoped table has an index whose leading column is `tenant_id`,
  either standalone or through a primary/unique constraint;
- future objects are private by default and must be deliberately added to the
  Data API contract.

The canonical load-mutation bridge
`20260826160000_canonical_load_mutations.sql` removed authenticated direct
mutation of `load_items` and direct update of `loads.status`. It introduces
audited status transitions, transactional item composition and atomic total
recalculation. Its production-generated ledger entry is
`20260826213623_canonical_load_mutations`. Deploy only frontend code that uses
`transition_load_status_v1`, `upsert_load_item_v3` and the composition `*_v2`
RPCs after this bridge is present.

Fiscal polling Edge Functions accept either a validated user JWT plus an active
operator/admin membership in the target tenant, or a dedicated cron secret
validated through a `service_role`-only Vault RPC. The five scheduled jobs keep
URL, publishable key, tenant, and the rotated 256-bit cron secret in Vault rather
than in `cron.job` text. Provider rate limits stop a polling batch cleanly and
return a successful partial result instead of hammering the provider.
Fiscal webhooks fail closed when their shared secret is missing. Integration
passwords must use the `enc:v1:` envelope and credential writers fail closed when
`AGVLOG_ENCRYPTION_KEY` is absent.

The application is invite-only and its local Auth contract requires at least 12
characters with upper/lowercase letters and a digit. All interactive roles use
the same single-factor session; owner/admin mutations still require active
tenant membership and their corresponding role in frontend guards, RLS helpers
and human Edge handlers. Cron, webhook, operator, driver and portal flows retain
their separate least-privilege checks. Portal V2 RPC execution is
explicitly granted to `authenticated`, while POD Storage metadata is resolved
only after portal authorization and its audit RPC remains backend-only.

## Verification

Latest repository and production checks on 2026-08-28:

- the forward hardening migrations through
  `20260826215934_remove_permissive_policy_overlaps` were accepted by the
  production PostgreSQL 17 project;
- the remote verification returned `baseline_contract_ok` with 187 public
  tables, 277 functions, 731 RLS policies and 993 indexes;
- baseline contract: 20/20 static checks passing, including authenticated
  execution of every helper required by an RLS policy and absence of duplicate
  permissive action policies;
- Edge Function TypeScript syntax: 36/36 files accepted;
- application tests: 432/432 passing across 52 files;
- TypeScript application check and production build: successful;
- local TypeScript database types exactly match the hosted catalog;
- active migration directory contains the immutable snapshot plus ordered
  forward migrations;
- active baseline/bootstrap scan: no embedded JWT, Supabase URL, tenant ID, or
  cron credential value.

After applying the baseline and all forward migrations to an empty database, run
`verify/baseline_contract.sql`. It checks RLS, view security, client grants,
credential-column privileges, `SECURITY DEFINER` search paths, explicit policy
checks, encrypted integration passwords, Storage, Realtime, the event trigger,
and sequence ownership.

## Safe cutover

For a new or disposable environment:

1. Start an empty PostgreSQL 17 Supabase environment.
2. Run `supabase db reset` and apply `verify/baseline_contract.sql`.
3. Generate TypeScript types and compare them with
   `src/integrations/supabase/types.ts`.
4. Run security and performance advisors, application tests, and the production
   build.
5. Configure Vault secrets and run `bootstrap/cron_jobs.sql`.

## Production ledger reconciliation

Do not run a blind `db push`. The production ledger uses environment-generated
timestamps for four already-applied operations (extension relocation, FK
indexes, legacy RPC revocation and RLS helper grants), while the repository keeps
their reviewed logical versions. In addition, the consolidated RLS state was
observed in production without a matching historical ledger row. The 26/08
sequence for integration metadata, canonical loads, Storage limits, fiscal
terminalization/inbox, default privileges, portal RPCs, the historical
privileged-MFA change, its forward-only removal, and permissive-policy
consolidation is applied under remote-generated
timestamps. Compare migration names and postconditions rather than attempting to
insert the repository timestamp into the populated ledger. The final remote
contract passed after all nine operations.

For a populated project, do **not** push this baseline as a new migration: its
tables already exist. Generate and review an incremental bridge for that
environment and keep its production migration ledger intact. The SQL files in
`migration_history/` record this source project's cutover; the Vault extractor is
not a reusable environment bootstrap.

The source production project was cut over directly on 2026-08-24 (migration
`20260825014449` through `20260825020850`, UTC). Their transactional
postconditions and `verify/baseline_contract.sql` passed with zero tables without
RLS, zero tenant tables without a leading `tenant_id` index, zero anonymous
relation grants, zero dangerous browser grants, zero policy check gaps, and zero
browser grants on protected credential columns. TypeScript types match the live
catalog, all 29 Edge Functions are active, and production cron requests for the
pipeline, NFS-e, and CT-e return HTTP 200. All 22 non-SSX functions contain the
current package. SSX remains operationally out of scope until its credentials
are restored; its local dependencies and syntax are validated, while six
sensitive SSX deployments were intentionally left untouched. The two recovery
archives remain preserved for audit and rollback investigation.

One environment-owned credential still needs operator action: the existing SSX
integration password was encrypted with a different key than the current
`AGVLOG_ENCRYPTION_KEY`, so token refresh reports `Decryption failed`. Re-save the
SSX password through the frontend integration settings to encrypt it with the
current key. The database intentionally has no plaintext fallback.
