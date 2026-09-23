import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/pages/OccurrenceReturnSheet.tsx', 'utf8');

describe('signed occurrence return sheet popup', () => {
  it('opens during user activation and reports popup/signing failures', () => {
    const handler = page.indexOf('const openSignedReturnSheet');
    const open = page.indexOf("window.open('', '_blank')", handler);
    const signing = page.indexOf('await getSignedProofUrl(path)', handler);
    expect(handler).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(handler);
    expect(signing).toBeGreaterThan(open);
    expect(page).toContain('O navegador bloqueou a nova janela');
    expect(page).toContain('popup.opener = null');
    expect(page).toContain('popup.location.href = url');
    expect(page).toContain('popup.close()');
  });
});
