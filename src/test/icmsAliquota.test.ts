import { describe, expect, it } from 'vitest';
import {
  icmsIsentoByCst,
  shouldApplyIcmsAutoSuggestion,
  suggestIcmsAliquota,
} from '@/lib/fiscal/icmsAliquota';

describe('ICMS do CT-e', () => {
  it('sugere alíquotas intra e interestaduais', () => {
    expect(suggestIcmsAliquota('MG', 'MG')).toBe(18);
    expect(suggestIcmsAliquota('MG', 'BA')).toBe(7);
    expect(suggestIcmsAliquota('BA', 'MG')).toBe(12);
  });

  it('identifica CSTs isentos', () => {
    expect(icmsIsentoByCst('40')).toBe(true);
    expect(icmsIsentoByCst('41')).toBe(true);
    expect(icmsIsentoByCst('51')).toBe(true);
    expect(icmsIsentoByCst('00')).toBe(false);
  });

  it('respeita o controle de replicação fiscal e a trava manual', () => {
    expect(shouldApplyIcmsAutoSuggestion(0, 0, false, false)).toBe(true);
    expect(shouldApplyIcmsAutoSuggestion(1, 0, false, false)).toBe(false);
    expect(shouldApplyIcmsAutoSuggestion(1, 0, true, false)).toBe(true);
    expect(shouldApplyIcmsAutoSuggestion(1, 0, true, true)).toBe(false);
  });
});
