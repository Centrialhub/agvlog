import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/loads/NewLoadDialog.tsx', 'utf8');

describe('new load dialog accessibility', () => {
  it('describes the purpose of the dialog for assistive technology', () => {
    expect(source).toContain('DialogDescription');
    expect(source).toContain('associe notas fiscais de entrada à nova carga');
  });
});
