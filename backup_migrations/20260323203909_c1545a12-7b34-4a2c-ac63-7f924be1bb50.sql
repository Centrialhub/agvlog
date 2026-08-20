-- One-time patch: set speed=0 and movement_state="stopped" for all positions_last with null speed
UPDATE positions_last
SET
  speed = 0,
  source = COALESCE(source, '{}'::jsonb) || '{"speed_source": "inferred", "movement_state": "stopped"}'::jsonb
WHERE speed IS NULL;
-- linter:allow-no-tenant legacy-migration 2026-12-31
