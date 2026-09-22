import { describe, expect, it } from 'vitest';
import { ingestionSelectionError, ortSelectionError } from '@/lib/ingestion/uploadLimits';

const file = (name: string, size: number) => ({ name, size }) as File;

describe('ingestion upload limits', () => {
  it('rejects excessive file counts before reading contents', () => {
    expect(ingestionSelectionError(Array.from({ length: 501 }, (_, index) => file(`${index}.xml`, 1))))
      .toContain('no máximo 500');
  });

  it('rejects oversized files and aggregate payloads', () => {
    expect(ingestionSelectionError([file('huge.xlsx', 10 * 1024 * 1024 + 1)])).toContain('10 MB');
    expect(ingestionSelectionError(Array.from({ length: 6 }, (_, index) => file(`${index}.xml`, 9 * 1024 * 1024))))
      .toContain('50 MB');
  });

  it('accepts a bounded batch', () => {
    expect(ingestionSelectionError([file('note.xml', 1024), file('orders.xlsx', 2048)])).toBeNull();
  });

  it('accepts the reported batch of 337 XML invoices', () => {
    expect(ingestionSelectionError(Array.from({ length: 337 }, (_, index) => file(`${index}.xml`, 30_000))))
      .toBeNull();
  });
});

describe('ORT scan upload limits', () => {
  it('rejects more than five pages before base64 conversion', () => {
    expect(ortSelectionError(Array.from({ length: 6 }, (_, index) => file(`${index}.jpg`, 1))))
      .toContain('no máximo 5');
  });

  it('enforces both per-file and encoded aggregate limits', () => {
    expect(ortSelectionError([file('large.pdf', 3 * 1024 * 1024 + 1)])).toContain('3 MB');
    expect(ortSelectionError([file('a.jpg', 3 * 1024 * 1024), file('b.jpg', 3 * 1024 * 1024), file('c.jpg', 1)]))
      .toContain('8 MB');
  });
});
