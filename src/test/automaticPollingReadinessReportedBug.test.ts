import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pipeline = readFileSync(resolve('supabase/functions/agvlog-pipeline-run/index.ts'), 'utf8');
const migration = readFileSync(resolve('supabase/migrations/20260917152200_track_automatic_poll_continuity.sql'), 'utf8');

describe('reported automatic polling readiness bug', () => {
  it('increments continuity only for cron poll/full runs that executed polling successfully', () => {
    expect(pipeline).toContain('Boolean(isCron) && (mode === "poll" || mode === "full")');
    expect(pipeline).toContain('stats.steps_executed.includes("position_polling")');
    expect(pipeline).toContain('_increment_success: automaticPollingSucceeded');
  });

  it('revalidates automatic evidence at the database boundary', () => {
    expect(migration).toContain("coalesce(_patch->>'last_run_mode','') in ('poll','full')");
    expect(migration).toContain("coalesce(_patch->'last_run_steps','[]'::jsonb) ? 'position_polling'");
    expect(migration).toContain("'recent_automatic_poll_runs',v_history");
  });
});
