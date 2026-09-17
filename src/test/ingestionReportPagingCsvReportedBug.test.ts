import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildIngestionReportCsv } from '@/pages/IngestionReports';

const page = readFileSync('src/pages/IngestionReports.tsx', 'utf8');
const migration = readFileSync(
  'supabase/migrations/20260917151400_page_ingestion_report_index.sql',
  'utf8',
);

describe('reported ingestion report paging and CSV bugs', () => {
  it('pages a scalar server index and loads one heavy detail on demand', () => {
    expect(page).toContain("'get_ingestion_report_index_v1'");
    expect(page).not.toContain('fetchAllPostgrestPages');
    expect(page).toContain("queryKey: ['ingestion_report_detail'");
    expect(page).toContain(".eq('id', selectedId!)");
    expect(page).toContain('const pageSize = 25');
    expect(migration).toContain('limit _page_size offset');
    expect(migration).toContain("'snapshot_at', effective_snapshot");
    const filtered = migration.slice(migration.indexOf('with filtered'), migration.indexOf('),\n  totals as'));
    expect(filtered).not.toContain('field_coverage');
    expect(filtered).not.toContain('review_items');
    expect(filtered).not.toContain('report jsonb');
  });

  it.each(['=CMD()', '+SUM(1,1)', '-2+3', '@HYPERLINK("x")'])('%s is neutralized in every dynamic CSV column', (payload) => {
    const row = {
      id: 'report-id',
      tenant_id: 'tenant-id',
      batch_id: 'batch-id',
      source_label: payload,
      total_docs: 1,
      saved_docs: 0,
      error_docs: 0,
      needs_review_docs: 1,
      clients_auto_created: 0,
      clients_matched: 0,
      clients_unresolved: 1,
      field_coverage: [{ key: 'field', label: payload, filled: 0, total: 1 }],
      review_items: [{ invoiceNumber: payload, recipientName: payload, reasons: [payload] }],
      report: {},
      created_by: null,
      created_at: '2026-09-17T00:00:00Z',
    } as Parameters<typeof buildIngestionReportCsv>[0];

    const csv = buildIngestionReportCsv(row);
    expect(csv).not.toContain(`;${payload}`);
    expect(csv).toContain(`'${payload.replace(/"/g, '""')}`);
  });
});
