import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('captura do artefato de provas monetárias', () => {
  it('só escreve o snapshot quando a captura foi solicitada explicitamente', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/test/financeVoidAwareMonetaryProofs.test.ts'),
      'utf8',
    );

    expect(source).toContain("process.env.CAPTURE_FINANCE_VOID_PROOFS==='1'");
    expect(source.indexOf("process.env.CAPTURE_FINANCE_VOID_PROOFS==='1'"))
      .toBeLessThan(source.indexOf("writeFileSync('docs/qa/finance-void-aware-monetary-proofs"));
  });
});
