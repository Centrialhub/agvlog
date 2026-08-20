UPDATE ingestion_cursors
SET last_success_at = NULL
WHERE last_success_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM positions_raw pr
    WHERE pr.vehicle_id = (
      SELECT vtl.vehicle_id FROM vehicle_tracker_links vtl
      WHERE vtl.provider_unit_id = ingestion_cursors.provider_unit_id
        AND vtl.active = true
      LIMIT 1
    )
    AND pr.tenant_id = ingestion_cursors.tenant_id
  );