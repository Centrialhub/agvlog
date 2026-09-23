import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('bounded traceability reader', () => {
  it('defaults to a recent period and only hydrates one remote document page', () => {
    const source=readFileSync('src/pages/Traceability.tsx','utf8');

    expect(source).toContain('importStart: daysAgoDateInput(30)');
    expect(source).toContain("{count:'exact'}");
    expect(source).toContain("documentsQuery.range((page-1)*TRACE_PAGE_SIZE,page*TRACE_PAGE_SIZE-1)");
    expect(source).toContain('Paginação da rastreabilidade');
    expect(source).not.toContain('fetchAllPostgrestPages<TraceDocument>');
    expect(source).toContain('Exportar página CSV');
  });
});
