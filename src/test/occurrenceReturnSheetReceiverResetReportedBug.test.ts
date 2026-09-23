import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/pages/OccurrenceReturnSheet.tsx', 'utf8');

describe('occurrence return sheet receiver state', () => {
  it('clears receiver identity after upload and every sheet/occurrence/tenant change', () => {
    expect(page).toContain('}, [activeSheet?.id, occurrenceId, currentTenant?.id]);');
    const uploadSuccess = page.slice(page.indexOf("toast.success('Folha assinada anexada')"), page.indexOf('} catch', page.indexOf("toast.success('Folha assinada anexada')")));
    expect(uploadSuccess).toContain("setReceiverName('')");
    expect(uploadSuccess).toContain("setReceiverDoc('')");
    const resetEffect = page.slice(page.indexOf('useEffect(() => {'), page.indexOf('}, [activeSheet?.id'));
    expect(resetEffect).toContain("setReceiverName('')");
    expect(resetEffect).toContain("setReceiverDoc('')");
  });
});
