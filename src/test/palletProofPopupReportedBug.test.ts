import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/pages/PalletReturns.tsx', 'utf8');

describe('signed pallet proof popup', () => {
  it('opens synchronously before signing and reports both popup and signing failures', () => {
    const open = page.indexOf("const popup = window.open('', '_blank')");
    const awaitSignedUrl = page.indexOf('await getPalletProofSignedUrl(path)');
    expect(open).toBeGreaterThan(-1);
    expect(awaitSignedUrl).toBeGreaterThan(open);
    expect(page).toContain("title: 'Pop-up bloqueado'");
    expect(page).toContain('popup.opener = null');
    expect(page).toContain('popup.location.href = url');
    expect(page).toContain('popup.close()');
    expect(page).toContain("title: 'Não foi possível abrir o comprovante'");
  });
});
