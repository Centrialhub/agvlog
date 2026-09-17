import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260917145300_archive_failed_cte_draft_history.sql', 'utf8');

describe('failed CT-e draft audit retention', () => {
  it('archives the draft, SEFAZ events, provider attempts and actor before deletion', () => {
    expect(migration).toContain('create table if not exists public.cte_failed_draft_archives');
    expect(migration).toContain('to_jsonb(v_draft), v_sefaz_events, v_hub_emissions');
    expect(migration).toContain('archived_by');
    expect(migration.indexOf('insert into public.cte_failed_draft_archives')).toBeLessThan(migration.indexOf('delete from public.cte_sefaz_events'));
    expect(migration.indexOf('delete from public.cte_sefaz_events')).toBeLessThan(migration.indexOf('delete from public.cte_documents'));
  });

  it('keeps a searchable link on surviving provider emission rows and audits cleanup', () => {
    expect(migration).toContain('archived_cte_document_id = v_draft.id');
    expect(migration).toContain("'failed_draft_archived'");
  });
});
