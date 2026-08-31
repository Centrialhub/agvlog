import { describe, it, expect } from 'vitest';
import { checklistItems, driverErrorMessage } from '@/lib/driverChecklist';
describe('checklist payload validation', () => {
  it.each([null, {}, {checked_items:[0,0]}, {checked_items:['0']}, {checked_items:[8]}, {checked_items:[0.5]}])(
    'fails closed for malformed payload %#', payload => expect(checklistItems(payload,8)).toEqual([]),
  );
  it('keeps partial and complete valid checklists', () => {
    expect(checklistItems({checked_items:[0,2]},8)).toEqual([0,2]);
    expect(checklistItems({checked_items:[0,1,2,3,4]},5)).toHaveLength(5);
    expect(checklistItems({checked_items:[0,1,2,3,4,5]},5)).toEqual([]);
  });
  it('handles both JavaScript and PostgREST errors without leaking other fields', () => {
    expect(driverErrorMessage({message:'Conflict',details:'hidden'},'fallback')).toBe('Conflict');
    expect(driverErrorMessage(new Error('Offline'),'fallback')).toBe('Offline');
    expect(driverErrorMessage(null,'fallback')).toBe('fallback');
  });
});
