import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ResultsStep from '@/components/ingestion/ResultsStep';
import type { IngestionReport } from '@/lib/ingestion/types';

vi.mock('@/hooks/useSonnerToast', () => ({
  useSonnerToast: () => ({ success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
}));

const report: IngestionReport = {
  totalDocs: 1, savedDocs: 0, errorDocs: 0, needsReviewDocs: 1,
  clientsAutoCreated: 0, clientsMatched: 0, clientsUnresolved: 0,
  fieldCoverage: [],
  auditMeta: { tenantName: '=HYPERLINK(1)' },
  reviewItems: [{ invoiceNumber: '=2+3', recipientName: '  @SUM(1)', reasons: ['=CMD(1)'] }],
};

const readBlob = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsText(blob);
});

describe('ingestion quality CSV downloads', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('neutralizes formulas in the full and compact exports', async () => {
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
      blobs.push(blob as Blob);
      return `blob:quality-${blobs.length}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    render(<MemoryRouter><ResultsStep results={[]} report={report} onReset={() => undefined} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    fireEvent.click(screen.getByRole('button', { name: 'CSV resumido' }));

    expect(blobs).toHaveLength(2);
    for (const blob of blobs) {
      const csv = await readBlob(blob);
      expect(csv).toContain("'=HYPERLINK(1)");
      expect(csv).toContain("'=2+3");
      expect(csv).toContain("'  @SUM(1)");
      expect(csv).toContain("'=CMD(1)");
    }
  });
});
