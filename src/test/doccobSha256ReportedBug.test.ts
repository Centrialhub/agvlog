import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('hash do bundle DOCCOB', () => {
  it('não usa mais o hash proprietário curto e envia o SHA-256 gerado com o conteúdo', () => {
    const generator = readFileSync('src/lib/doccob/doccobGenerator.ts', 'utf8');
    const page = readFileSync('src/pages/BillingEdi.tsx', 'utf8');
    expect(generator).not.toContain('simpleHash');
    expect(generator).toContain("digest('SHA-256', new TextEncoder().encode(input))");
    expect(generator).toContain('hash: await sha256Utf8(content)');
    expect(page).toContain('const built = await generateDoccob(buildInput)');
    expect(page).toContain('contentHash: built.hash');
  });
});
