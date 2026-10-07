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
# Exact reviewed bytes only. The original manifest and supplemental manifest
# retain their identities; historical migrations are never replayed or repaired.
node --input-type=module - "$logs/forwards.sql" <<'NODE'
import fs from 'node:fs';
import { inspectBaselineCandidate } from './scripts/check-baseline-candidate.mjs';
const { candidate, followups, supplements } = await inspectBaselineCandidate(process.cwd());
const files = [...candidate.forwards, ...(followups?.forwards ?? []), ...(supplements?.forwards ?? [])];
const sql = files.map(({filename}) => fs.readFileSync(`supabase/migrations/${filename}`, 'utf8')).join('\n');
if (/^\s*(?:begin|commit|rollback)\s*;/im.test(sql)) throw new Error('Unexpected transaction boundary in reviewed forward');
const contract = fs.readFileSync('supabase/verify/baseline_contract.sql', 'utf8');
fs.writeFileSync(process.argv[2], `BEGIN;\n${sql}\n${contract}\nCOMMIT;\n`, {mode:0o600,flag:'wx'});
NODE
docker exec -i supabase_db_agvlog-local-staging psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$logs/forwards.sql" > "$logs/forwards.private.log" 2>&1
docker exec -i supabase_db_agvlog-local-staging psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/seed.sql > "$logs/seed.private.log" 2>&1
node scripts/verify-local-staging-runtime.mjs --application-prerequisites --baseline-approval-sha256 "$AGVLOG_REVIEWED_BASELINE_SHA256"
node scripts/prepare-local-staging.mjs --application --approved-sha256 "$AGVLOG_REVIEWED_BASELINE_SHA256"
node_modules/.bin/supabase stop --project-id agvlog-local-staging --workdir .local-staging
node_modules/.bin/supabase start --workdir .local-staging --network-id agvlog-local-staging-loopback
node scripts/verify-local-staging-runtime.mjs --application --baseline-approval-sha256 "$AGVLOG_REVIEWED_BASELINE_SHA256"
echo 'Reviewed baseline restored; tests and lint remain mandatory.'
