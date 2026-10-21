#!/usr/bin/env bash
# Run only on an ephemeral Linux runner with externally provisioned private
# artifacts. No download, remote database URL, credential, or ledger repair.
set -euo pipefail
umask 077
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
: "${AGVLOG_REVIEWED_BASELINE_DIRECTORY:?Private reviewed baseline directory must be provisioned outside the checkout}"
: "${AGVLOG_REVIEWED_BASELINE_SHA256:?Externally approved manifest SHA-256 is required}"
[[ $AGVLOG_REVIEWED_BASELINE_DIRECTORY = /* ]] || { echo 'Baseline directory must be absolute' >&2; exit 1; }
[[ $AGVLOG_REVIEWED_BASELINE_SHA256 =~ ^[a-f0-9]{64}$ ]] || exit 1
[[ $(git status --porcelain) = '' ]] || { echo 'Clean candidate required' >&2; exit 1; }
[[ -z ${DOCKER_HOST:-} || ${DOCKER_HOST:-} = unix:///var/run/docker.sock ]] || exit 1
[[ $(docker ps -aq --filter label=com.supabase.cli.project=agvlog-local-staging) = '' ]] || {
  echo 'Refusing to reuse an existing database in CI' >&2; exit 1;
}
node scripts/check-baseline-candidate.mjs
node scripts/prepare-ci-baseline-package.mjs
docker network create --driver bridge --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 agvlog-local-staging-loopback >/dev/null
node_modules/.bin/supabase start --workdir .local-staging --network-id agvlog-local-staging-loopback
logs=$(mktemp -d "${RUNNER_TEMP:-/tmp}/agvlog-baseline-logs.XXXXXXXX")
chmod 700 "$logs"
node scripts/restore-local-staging-baseline.mjs --approved-sha256 "$AGVLOG_REVIEWED_BASELINE_SHA256" \
  --expected-source-sha "$(git rev-parse HEAD)" --expected-public-tables 327 --expected-buckets 8 --log-directory "$logs"
# Restore the historical synthetic data before upgrading the captured schema.
# The fixture owns BEGIN/COMMIT. Do not widen its Auth-only replication scope
# or weaken any driver guard to create legacy accounts after this upgrade.
docker exec -i supabase_db_agvlog-local-staging psql -X --no-password -U postgres -d postgres \
  -v ON_ERROR_STOP=1 --file - < supabase/seed.sql > "$logs/seed.private.log" 2>&1
# Exact reviewed bytes only. Each forward owns one transaction; the two pinned
# address forwards keep their original BEGIN/COMMIT. A failure preserves the
# committed prefix and stops before catalog verification or app activation.
node scripts/prepare-reviewed-forward-execution.mjs --output-directory "$logs/forwards"
while IFS=$'\t' read -r mode file; do
  transaction=()
  case "$mode" in
    single) transaction=(--single-transaction) ;;
    self) ;;
    *) echo 'Unknown approved forward transaction mode' >&2; exit 1 ;;
  esac
  docker exec -i supabase_db_agvlog-local-staging psql -X --no-password -U postgres -d postgres \
    -v ON_ERROR_STOP=1 "${transaction[@]}" --file - < "$logs/forwards/$file" \
    > "$logs/forwards/$file.private.log" 2>&1
done < "$logs/forwards/plan.tsv"
# Extension-owned SQL is repaired by its existing owner only in the verified
# disposable fixture. This does not grant the role or authorize production use.
node scripts/apply-reviewed-postgis-compatibility.mjs > "$logs/postgis-platform-contract.json"
docker exec -i supabase_db_agvlog-local-staging psql -X --no-password -U postgres -d postgres \
  -v ON_ERROR_STOP=1 --single-transaction --file - < "$logs/forwards/baseline-contract.sql" \
  > "$logs/catalog-contract.private.log" 2>&1

node scripts/verify-local-staging-runtime.mjs --application-prerequisites --baseline-approval-sha256 "$AGVLOG_REVIEWED_BASELINE_SHA256"
node scripts/prepare-local-staging.mjs --application --approved-sha256 "$AGVLOG_REVIEWED_BASELINE_SHA256"
node_modules/.bin/supabase stop --project-id agvlog-local-staging --workdir .local-staging
node_modules/.bin/supabase start --workdir .local-staging --network-id agvlog-local-staging-loopback
node scripts/verify-local-staging-runtime.mjs --application --baseline-approval-sha256 "$AGVLOG_REVIEWED_BASELINE_SHA256"
echo 'Reviewed baseline restored; tests and lint remain mandatory.'
