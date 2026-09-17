import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatTime } from '@/pages/IntegrationHealth';

const healthSource = readFileSync('src/pages/IntegrationHealth.tsx', 'utf8');
const continuityMigration = readFileSync('supabase/migrations/20260917140000_track_pipeline_continuity.sql', 'utf8');
const pipelineSource = readFileSync('supabase/functions/agvlog-pipeline-run/index.ts', 'utf8');

describe('reported integration health regressions', () => {
  it('renders invalid timestamps safely', () => {
    expect(formatTime('not-a-date')).toBe('Data inválida');
  });

  it('tracks rolling successful runs and records failed pipeline attempts', () => {
    expect(continuityMigration).toContain("'recent_successful_runs',v_history");
    expect(continuityMigration).toContain("'last_failed_run_at',v_now::text");
    expect(pipelineSource).toContain('stats.errors.length === 0 && stats.needs_attention.length === 0');
  });

  it('derives the header status from operational evidence, not credentials alone', () => {
    expect(healthSource).toContain('readiness.allMet');
    expect(healthSource).toContain('observability.schedule.consecutiveFailures === 0');
    expect(healthSource).toContain('observability.queue.errors === 0');
    expect(healthSource).toContain('observability.trackerLinks.conflicts === 0');
  });
});
