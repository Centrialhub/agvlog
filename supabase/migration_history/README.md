# Baseline cutover history

The active migration chain was consolidated on 2026-08-24. The ZIP archives are
controlled local recovery artifacts, excluded from Git, and are not applied by
the Supabase CLI. Their checksums remain documented for audit verification.

| Artifact | Entries/lines | SHA-256 |
| --- | ---: | --- |
| `pre_baseline_local_20260824.zip` | 236 | `0A0892482B2603AAFA87AE2D91AACDC7219BC1B424B6FF0DFE41AD9384AB6C33` |
| `pre_baseline_remote_20260824.zip` | 299 | `6A228B72683F1501D084CAD23CF91DA609FBB54D3840A80AD13534136E96B1BB` |
| `production_baseline_hardening.sql` | 600 | `3583A62098600AA349C39797F03EB107A2BD13383DBEB0BE9304B7E2C1D2A77B` |
| `production_frontend_fk_indexes.sql` | 48 | `66A08A55A83008B694479A5A84B42BAD42B1AB12FD02B89E17C11F85DC02E7BF` |
| `production_secure_cron_vault.sql` | 127 | `767A3C66547AA3338B00F4E397FD2E6B4755283C2FDB151148ADEA1A511A5766` |
| `production_cte_status_poll_contract.sql` | 41 | `37C73E584F72E9EDBA4102AE6BD8F7A4FFA6E2B01CE2C47C6F3616C28FCAD93B` |

Only 46 migration timestamps matched between the old local folder and the remote
history. The remote archive is therefore the authoritative audit trail; both
archives are retained in controlled local audit storage to explain the former
repository state without publishing legacy SQL bundles.

To inspect an archive without changing the active migration folder, expand it into
a temporary directory. Never extract either archive directly into
`supabase/migrations` while the baseline is active.

The four production SQL bridges were applied directly to project
`qcvnsdrbcchaxvawcngk` as remote migrations:

- `20260825014449_production_baseline_hardening`;
- `20260825015349_production_frontend_fk_indexes`;
- `20260825020506_production_secure_cron_vault`;
- `20260825020850_production_cte_status_poll_contract`.

They are deliberately outside the active migration directory because their final
state is already included in the single baseline. The Vault/cron bridge is
source-project-specific: it extracts the former legacy job configuration, rotates
the cron secret, and must not be replayed on another environment. The remote
migration ledger remains the immutable production audit trail and must not be
truncated to imitate a fresh database. `bootstrap/cron_jobs.sql` was then run to
recreate all five jobs with Vault-backed values and explicit HTTP timeouts.
