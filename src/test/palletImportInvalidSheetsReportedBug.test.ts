import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { palletReturnValidationErrors, type ParsedPalletReturn } from '@/lib/palletReturns/palletReturnImporter';

const page = readFileSync('src/pages/PalletReturns.tsx', 'utf8');
const hook = readFileSync('src/hooks/usePalletReturns.tsx', 'utf8');

const parsed = (patch: Partial<ParsedPalletReturn>): ParsedPalletReturn => ({
  supplier: 'Fornecedor', companyOrigin: null, issueDate: '2026-09-22', items: [{ code: 'PBR', name: 'PBR', quantity: 1 }],
  totalDeclared: 1, totalCalculated: 1, hasTotalDivergence: false, rawTitle: null, rawReceiverText: null,
  ...patch,
});

describe('invalid pallet import sheets', () => {
  it('explains every locally rejected sheet', () => {
    expect(palletReturnValidationErrors(parsed({ supplier: null }))).toEqual(['fornecedor não detectado']);
    expect(palletReturnValidationErrors(parsed({ issueDate: null, items: [] }))).toEqual([
      'data não detectada', 'nenhum item detectado',
    ]);
  });

  it('sends local rejections to the batch and counts all workbook sheets', () => {
    expect(page).toContain('localErrors: rejected');
    expect(page).not.toContain("if (valid.length === 0) { toast({ title: 'Nada para importar'");
    expect(hook).toContain('row_count: input.parsedList.length + input.localErrors.length');
    expect(hook).toContain('[...input.localErrors]');
  });
});
