import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

const page=readFileSync('src/pages/BillingEdi.tsx','utf8');
const hook=readFileSync('src/hooks/useBillingEdi.tsx','utf8');

describe('DOCCOB form and profile safety',()=>{
  it('blocks inverted issue and due periods',()=>{
    expect(page).toContain('issuePeriodInvalid');expect(page).toContain('duePeriodInvalid');expect(page).toContain('A data inicial não pode ser posterior');expect(hook).toContain("filters.enabled !== false");
  });
  it('rejects an empty or invalid file date before resolving a name',()=>{
    expect(page).toContain('const validFileDate');expect(page).toContain("if (!validFileDate)");expect(page).toContain('disabled={!validFileDate');
  });
  it('closes and remounts dialogs when the tenant changes',()=>{
    expect(page).toContain('setGenOpen(false)');expect(page).toContain('setProfileDlgOpen(false)');expect(page).toContain('key={`generate:${currentTenant?.id');expect(page).toContain('key={`profile:${currentTenant?.id');
  });
  it('uses the loaded profile revision for compare-and-swap updates',()=>{
    expect(hook).toContain('expectedUpdatedAt');expect(hook).toContain(".eq('updated_at', expectedUpdatedAt ?? '')");expect(hook).not.toContain('.upsert(row)');expect(hook).toContain('O perfil foi alterado por outra pessoa');
  });
});
