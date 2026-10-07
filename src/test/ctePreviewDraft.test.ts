import { describe, expect, it } from 'vitest';
import { groupToEditable } from '@/components/billing/ctePreviewDraft';
import { buildGroups } from '@/lib/cteGroupingModes';
import { applyCteFreightPatch } from '@/lib/fiscal/ctePreviewFreight';
import type { FiscalDocument } from '@/hooks/useFiscalDocuments';

const documents = [
  { id: 'nf-a', invoice_number: '101', access_key: '31' + '1'.repeat(42),
    value: 9876.54, freight_value: 80, weight_kg: 40, pallet_count: 1 },
  { id: 'nf-b', invoice_number: '102', access_key: '31' + '2'.repeat(42),
    value: 5432.10, freight_value: 120, weight_kg: 60, pallet_count: 2 },
] as FiscalDocument[];

describe('CT-e grouping to editable preview', () => {
  it.each([1, 8])('preserves freight, cargo and invoice identity in grouping mode %s', mode => {
    const drafts = buildGroups(documents, mode).map(group => groupToEditable(group, 'emitter-a'));
    expect(drafts.map(draft => draft.freightValue)).toEqual(mode === 1 ? [80, 120] : [200]);
    const expectedCargo = mode === 1 ? [9876.54, 5432.10] : [15308.64];
    expect(drafts).toHaveLength(expectedCargo.length);
    drafts.forEach((draft, index) => expect(draft.cargoValue).toBeCloseTo(expectedCargo[index], 2));
    expect(drafts.flatMap(draft => draft.invoices.map(invoice => invoice.id))).toEqual(['nf-a', 'nf-b']);
    expect(drafts.flatMap(draft => draft.invoices.map(invoice => invoice.value))).toEqual([9876.54, 5432.10]);
    expect(drafts.reduce((sum, draft) => sum + draft.weightKg, 0)).toBe(100);
    const manuallyEdited = applyCteFreightPatch(drafts[0], { freightValue: 42.42 });
    expect(manuallyEdited.freightValue).toBe(42.42);
    expect(manuallyEdited.cargoValue).toBe(drafts[0].cargoValue);
    expect(manuallyEdited.invoices).toEqual(drafts[0].invoices);
  });

  it('keeps missing freight empty even when the imported cargo amount is positive', () => {
    const [group] = buildGroups([{ ...documents[0], freight_value: null }], 1);
    const draft = groupToEditable(group, 'emitter-a');
    expect(draft.freightValue).toBe(0);
    expect(draft.cargoValue).toBe(9876.54);
    expect(draft.invoices[0].value).toBe(9876.54);
  });
});
