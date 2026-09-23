import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/pages/PalletReturns.tsx', 'utf8');

describe('pallet return tenant-scoped UI state', () => {
  it('clears every protocol target and its mutable fields when the tenant changes', () => {
    const cleanup = page.slice(page.indexOf('setDetail(null);', page.indexOf('const [editItems')),
      page.indexOf('}, [currentTenant?.id]);', page.indexOf('const [editItems')));
    for (const reset of [
      'setDetail(null)', 'setCancelTarget(null)', 'setAttachTarget(null)', 'setEditTarget(null)',
      "setCancelReason('')", "setReceiverName('')", 'setProofFile(null)', "setEditSupplierName('')",
      "setEditIssueDate('')", "setEditReturnDate('')", "setEditDriver('')", "setEditPlate('')",
      "setEditNotes('')", "setEditReason('')", 'setEditItems([])',
    ]) expect(cleanup).toContain(reset);
    expect(cleanup).toContain('setSignatureDate(localDateInputValue())');
  });
});
