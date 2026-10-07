import { createHash } from 'node:crypto';
import { posix } from 'node:path';

export const restoreInventorySql = `BEGIN READ ONLY;
SELECT json_build_object(
 'publicTables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')),
 'publicTablesWithoutRls',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity),
 'buckets',(SELECT count(*) FROM storage.buckets),
 'cronJobs',(SELECT count(*) FROM cron.job),
 'vaultSecrets',(SELECT count(*) FROM vault.secrets),
 'httpQueue',(SELECT count(*) FROM net.http_request_queue),
 'authUsers',(SELECT count(*) FROM auth.users),
 'storageObjects',(SELECT count(*) FROM storage.objects));
COMMIT;`;

export function validRestoreCounts(counts, expectedPublicTables, expectedBuckets) {
  const zeroKeys = ['publicTablesWithoutRls', 'cronJobs', 'vaultSecrets', 'httpQueue', 'authUsers', 'storageObjects'];
  const keys = ['publicTables', 'buckets', ...zeroKeys];
  return counts && Object.keys(counts).length === keys.length && keys.every((key) => Number.isSafeInteger(counts[key])) &&
    counts.publicTables === expectedPublicTables && counts.buckets === expectedBuckets && zeroKeys.every((key) => counts[key] === 0);
}

// All interpolated numbers are checked here as well as at the command boundary.
// SQL contents are trusted only after approval/file verification by the caller.
// psql wraps this complete input in its own single transaction; forwards are excluded.
export function buildLocalBaselineRestoreSql(baseline, expectedPublicTables, expectedBuckets) {
  if (!Number.isSafeInteger(expectedPublicTables) || expectedPublicTables < 1 ||
      !Number.isSafeInteger(expectedBuckets) || expectedBuckets < 0) throw new Error('invalid_expected_inventory');
  const prefix = posix.dirname(baseline.approvalArtifact);
  const parts = [Buffer.from(`SET statement_timeout = '120s';
SET lock_timeout = '10s';
DO $agv_restore_empty$
BEGIN
 IF NOT pg_try_advisory_xact_lock(1935763318, 55322) THEN
  RAISE EXCEPTION 'local_baseline_restore_already_running';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p'))
    OR EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM storage.buckets) OR EXISTS(SELECT 1 FROM storage.objects) THEN
  RAISE EXCEPTION 'local_baseline_target_not_empty';
 END IF;
END $agv_restore_empty$;
`)];
  for (const artifact of baseline.approval.artifacts) {
    const bytes = baseline.files.get(`${prefix}/${artifact.filename}`);
    if (!Buffer.isBuffer(bytes) || bytes.length !== artifact.bytes ||
        createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('baseline_artifact_changed');
    parts.push(bytes, Buffer.from('\n'));
  }
  // Assertions run before psql COMMIT, including row checks under the restore role.
  // RESET ROLE restores supabase_admin after any reviewed SET ROLE wrapper.
  parts.push(Buffer.from(`RESET ROLE;
SET statement_timeout = '120s';
SET lock_timeout = '10s';
SET row_security = off;
DO $agv_restore_inventory$
DECLARE t record; has_rows boolean;
BEGIN
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')) <> ${expectedPublicTables}
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity)
    OR (SELECT count(*) FROM storage.buckets) <> ${expectedBuckets}
    OR EXISTS(SELECT 1 FROM cron.job) OR EXISTS(SELECT 1 FROM vault.secrets) OR EXISTS(SELECT 1 FROM net.http_request_queue)
    OR EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM storage.objects) THEN
  RAISE EXCEPTION 'local_baseline_inventory_mismatch';
 END IF;
 FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I)', t.relname) INTO has_rows;
  IF has_rows THEN RAISE EXCEPTION 'local_baseline_contains_application_data'; END IF;
 END LOOP;
END $agv_restore_inventory$;
SELECT pg_notify('pgrst','reload schema');
`));
  return Buffer.concat(parts);
}
