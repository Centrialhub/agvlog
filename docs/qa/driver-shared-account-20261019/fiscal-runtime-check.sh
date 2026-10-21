#!/bin/sh
set -eu
name=agvlog-driver-fiscal-probe-20261019
network=agvlog-driver-fiscal-probe-20261019
root=${AGVLOG_FISCAL_PROBE_CONTEXT:?Supply the verified minimal probe context; never mount node_modules or environment files}
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || true; docker network rm "$network" >/dev/null 2>&1 || true; }
docker network create --internal "$network" >/dev/null
trap cleanup EXIT
docker run -d --name "$name" --network "$network" \
  --mount type=bind,source="$root",target=/app,readonly \
  public.ecr.aws/supabase/edge-runtime:v1.77.4 start --verbose \
  --main-service /app/docs/qa/driver-shared-account-20261019/fiscal-main >/dev/null
for i in $(seq 1 30); do
  if docker run --rm --network "$network" --entrypoint curl public.ecr.aws/supabase/postgres:17.6.1.165 \
    --silent --show-error --fail --max-time 30 "http://$name:9000/" \
    > /mnt/f/AGVLOG/checks/security-backports-edge-fiscal-result-20261019.json; then
    docker logs "$name" > /mnt/f/AGVLOG/checks/security-backports-edge-fiscal-20261019.log 2>&1
    cat /mnt/f/AGVLOG/checks/security-backports-edge-fiscal-result-20261019.json
    exit 0
  fi
  sleep 1
done
docker logs "$name" > /mnt/f/AGVLOG/checks/security-backports-edge-fiscal-20261019.log 2>&1
docker inspect "$name" --format '{{json .State}}' >> /mnt/f/AGVLOG/checks/security-backports-edge-fiscal-20261019.log
exit 1
