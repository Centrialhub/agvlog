import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { csvSafeCell } from '@/lib/csvSafety';
import { toCsvString } from '@/lib/occurrenceReports/occurrenceReportCsv';
import { ruralProfilesToCsv } from '@/lib/ruralClients/ruralDeliveryReports';
import { buildLoadControlCsv } from '@/lib/loadReports/loadControlCsv';
import type { RuralProfile } from '@/hooks/useRuralClients';
import type { LoadControlRow } from '@/hooks/useLoadControl';

describe('CSV exports outside the previously reviewed report flows', () => {
  it.each(['=1+2', '  =1+2', '\t=1+2', '@SUM(1)', '-1+2'])(
    'neutralizes a spreadsheet formula even after leading whitespace: %s',
    value => expect(csvSafeCell(value)).toContain(`'${value}`),
  );

  it('protects occurrence values and preserves semicolons and carriage returns in one cell', () => {
    const csv = toCsvString(
      ['Cliente', 'Observação'],
      [{ name: '=HYPERLINK(1)', note: 'linha;um\r\nlinha dois' }],
      ['name', 'note'],
    );
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).toContain('"linha;um\r\nlinha dois"');
  });

  it('protects rural client names and driver instructions', () => {
    const csv = ruralProfilesToCsv([{
      client_name: '=1+2', driver_instructions: '  =HYPERLINK(1)',
    } as RuralProfile]);
    expect(csv).toContain("'=1+2");
    expect(csv).toContain("'  =HYPERLINK(1)");
  });

  it('protects load control values before the download is created', () => {
    const csv = buildLoadControlCsv([{
      load_number: 'L-1', client_name: '=1+2', driver_name: 'Nome;com\rquebra',
    } as LoadControlRow]);
    expect(csv).toContain("'=1+2");
    expect(csv).toContain('"Nome;com\rquebra"');
  });

  it('uses the checked cell encoder in traceability, fleet and ingestion exports', () => {
    const traceability = readFileSync('src/pages/Traceability.tsx', 'utf8');
    const fleet = readFileSync('src/pages/Reports.tsx', 'utf8');
    const ingestionResults = readFileSync('src/components/ingestion/ResultsStep.tsx', 'utf8');
    expect(traceability.match(/row\.map\(csvSafeCell\)/g)).toHaveLength(2);
    expect(fleet).toContain('row.map(csvSafeCell)');
    expect(ingestionResults.match(/const esc = csvSafeCell;/g)).toHaveLength(2);
  });
});
