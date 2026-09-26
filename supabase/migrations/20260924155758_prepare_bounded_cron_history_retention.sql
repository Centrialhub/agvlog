-- Preparation only: disabled until the separately reviewed rollout is activated.
-- Do not modify extension-owned cron tables, their indexes, or business jobs.
DO $guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Apply cron retention as postgres';
  END IF;
  IF NOT (pg_catalog.has_table_privilege(current_user, 'cron.job_run_details', 'SELECT')
    AND pg_catalog.has_table_privilege(current_user, 'cron.job_run_details', 'DELETE')
    AND pg_catalog.has_table_privilege(current_user, 'cron.job_run_details', 'UPDATE')) THEN
    RAISE EXCEPTION 'Missing cron history privileges';
  END IF;
END
$guard$;

CREATE SCHEMA cron_retention_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA cron_retention_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE cron_retention_private.control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  last_runid bigint NOT NULL DEFAULT 0 CHECK (last_runid >= 0),
  last_scanned integer NOT NULL DEFAULT 0,
  last_deleted integer NOT NULL DEFAULT 0,
  total_deleted bigint NOT NULL DEFAULT 0,
  completed_cycles bigint NOT NULL DEFAULT 0,
  last_completed_at timestamptz
);
ALTER TABLE cron_retention_private.control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cron_retention_private.control FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO cron_retention_private.control(singleton) VALUES (true);

CREATE FUNCTION cron_retention_private.prune_success_history_v1(_batch_size integer DEFAULT 1000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
SET lock_timeout = '250ms'
AS $function$
DECLARE
  _control cron_retention_private.control%ROWTYPE;
  _cutoff timestamptz := pg_catalog.statement_timestamp() - interval '30 days';
  _scanned integer;
  _deleted integer;
  _next bigint;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Cron retention requires postgres' USING ERRCODE = '42501';
  END IF;
  IF _batch_size IS NULL OR _batch_size < 1 OR _batch_size > 1000 THEN
    RAISE EXCEPTION 'Batch size must be between 1 and 1000' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _control FROM cron_retention_private.control
    WHERE singleton FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT FROM cron_retention_private.control WHERE singleton) THEN
      RAISE EXCEPTION 'Cron retention control is missing';
    END IF;
    RETURN pg_catalog.jsonb_build_object('status', 'busy');
  END IF;
  IF NOT _control.enabled THEN
    RETURN pg_catalog.jsonb_build_object('status', 'disabled');
  END IF;

  -- Limit before filtering: retained failures must not cause an unbounded scan.
  -- Runids are the existing pg_cron primary key. Wrap to revisit aging/locked rows.
  WITH scan AS MATERIALIZED (
    SELECT d.runid FROM cron.job_run_details d
    WHERE d.runid > _control.last_runid ORDER BY d.runid LIMIT _batch_size
  ), eligible AS MATERIALIZED (
    SELECT locked.runid FROM scan s
    CROSS JOIN LATERAL (
      SELECT d.runid FROM cron.job_run_details d
      WHERE d.runid = s.runid AND d.status = 'succeeded' AND d.end_time < _cutoff
        AND d.username = current_user AND d.database = pg_catalog.current_database()
      FOR UPDATE OF d SKIP LOCKED
    ) locked
  ), removed AS (
    DELETE FROM cron.job_run_details d USING eligible e
    WHERE d.runid = e.runid AND d.status = 'succeeded' AND d.end_time < _cutoff
      AND d.username = current_user AND d.database = pg_catalog.current_database()
    RETURNING d.runid
  )
  SELECT (SELECT count(*)::integer FROM scan),
         (SELECT max(runid) FROM scan),
         (SELECT count(*)::integer FROM removed)
  INTO _scanned, _next, _deleted;

  UPDATE cron_retention_private.control
  SET last_runid = coalesce(_next, 0), last_scanned = _scanned, last_deleted = _deleted,
      total_deleted = total_deleted + _deleted,
      completed_cycles = completed_cycles + CASE WHEN _scanned = 0 THEN 1 ELSE 0 END,
      last_completed_at = pg_catalog.clock_timestamp()
  WHERE singleton;
  RETURN pg_catalog.jsonb_build_object('status', 'ok', 'scanned', _scanned,
    'deleted', _deleted, 'cursor', coalesce(_next, 0), 'wrapped', _scanned = 0);
END
$function$;
REVOKE ALL ON FUNCTION cron_retention_private.prune_success_history_v1(integer)
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION cron_retention_private.prune_success_history_v1(integer) IS
  'Disabled by default. Prunes only own successful cron history older than 30 days. Caller must SET statement_timeout before invoking.';
