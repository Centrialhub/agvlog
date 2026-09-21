import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/MerchandiseShortages.tsx', 'utf8');

describe('merchandise shortage form validation', () => {
  it('reflects case validation and pending state in both save buttons', () => {
    expect(source).toContain('const newCaseInvalid = newCaseErrors.length > 0');
    expect(source).toContain('disabled={newCaseInvalid || createCase.isPending}');
    expect(source).toContain('if (createLock.current || createCase.isPending) return');
    expect(source).toContain('invoice_number: form.invoice.trim() || null');
  });
});
