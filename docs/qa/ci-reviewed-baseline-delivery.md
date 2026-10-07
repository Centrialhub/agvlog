# Private baseline delivery for CI

The historical replay is replaced with scripts/ci-reviewed-baseline.sh. It
requires the reviewed baseline package to be provisioned privately outside the
checkout and an independently pinned approval SHA-256. It refuses existing
containers, a dirty SHA, remote Docker sockets, and missing approval inputs.
Only the 13 reviewed forwards and seven reviewed supplements are applied.

Required runner environment:

- AGVLOG_REVIEWED_BASELINE_DIRECTORY: absolute path to the private baseline
  directory containing approval.json and revisions/<approved-hash>/approval.json.
- AGVLOG_REVIEWED_BASELINE_SHA256: independently approved SHA-256.

No private SQL, approval package, DSN, or token is committed or uploaded as a
public build artifact. Private restore/SQL logs are retained outside the
checkout and excluded from the public CI artifact upload.

The current hosted runner does not have this private artifact provisioned.
An approved private delivery mechanism is an explicit operational dependency,
not a successful CI run. This change does not create credentials, grant access,
change runner security, or provision paid resources. Do not add permissive
fallbacks to the broken historical reset. Until delivery is authorized and
configured, the database job must fail with the missing-artifact explanation.
