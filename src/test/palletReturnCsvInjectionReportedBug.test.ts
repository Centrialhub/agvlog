import { describe, expect, it } from 'vitest';
import { rowsToCsv } from '@/lib/palletReturns/palletReturnCsv';

describe('pallet return CSV injection protection', () => {
  it.each(['=SUM(A1:A2)', '+cmd', '-2+3', '@malicious', '  =HYPERLINK("x")'])(
    'neutralizes formula-like value %s',
    (value) => {
      expect(rowsToCsv(['Campo'], [[value]])).toContain(`'${value.replace(/"/g, '""')}`);
    },
  );

  it('neutralizes control-character prefixes and escapes every header through the same path', () => {
    expect(rowsToCsv(['=HEADER'], [['\tformula'], ['\rformula']])).toBe(
      '\uFEFF\'=HEADER\n\'\tformula\n"\'\rformula"',
    );
  });
});
