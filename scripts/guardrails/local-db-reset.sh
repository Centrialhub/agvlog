#!/usr/bin/env bash
# Prova de reprodutibilidade: aplica TODAS as migrations, em ordem, desde schema vazio,
# em um cluster Postgres local descartável. Nunca toca no banco vinculado (sem db push).
#
# Uso: scripts/guardrails/local-db-reset.sh [porta]
# Requer: binários postgres/initdb com as extensões usadas (postgis, pg_cron, pg_trgm, unaccent).
# Variáveis opcionais:
#   PGDIST  diretório da distribuição Postgres (default: /tmp/pgdist)
#   PGWORK  diretório de dados descartável (default: /tmp/pgreset)

set -uo pipefail

PORT="${1:-55432}"
PGDIST="${PGDIST:-/tmp/pgdist}"
PGWORK="${PGWORK:-/tmp/pgreset}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="$PGWORK/reset.log"

export PATH="$PGDIST/bin:$PATH"

DB="${RESET_DB:-resetdb}"
psql_run() { psql -h "$PGWORK" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 "$@"; }

echo "== supabase db reset (equivalente local, schema vazio) =="
: > "$LOG"

# schema vazio: recria o banco descartável a cada ciclo
psql -h "$PGWORK" -p "$PORT" -U postgres -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >>"$LOG" 2>&1
createdb -h "$PGWORK" -p "$PORT" -U postgres "$DB" >>"$LOG" 2>&1 || { echo "FALHA ao criar banco $DB"; exit 1; }

psql_run -f "$ROOT/scripts/ops/local-reset-bootstrap.sql" >>"$LOG" 2>&1 || {
  echo "FALHA no bootstrap da baseline da plataforma"; tail -30 "$LOG"; exit 1; }
echo "baseline da plataforma aplicada"

count=0
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
  count=$((count+1))
  if ! psql_run -f "$f" >>"$LOG" 2>&1; then
    echo "PRIMEIRA FALHA em ($count) $(basename "$f")"
    grep -E '^psql:' "$LOG" | tail -10
    exit 1
  fi
done
echo "OK: $count migrations aplicadas desde schema vazio"
