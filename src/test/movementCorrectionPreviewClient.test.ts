import {it,expect,vi} from 'vitest';
import {readMovementCorrectionPreview} from '@/lib/financial/movementCorrectionPreviewClient';
const mock=vi.hoisted(()=>vi.fn());vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock}}));
it('calls only the read-only preview by tenant and movement ID and propagates access refusal',async()=>{const tenant=crypto.randomUUID(),movement=crypto.randomUUID(),error={code:'42501',message:'finance_access_denied'};mock.mockResolvedValue({data:null,error});await expect(readMovementCorrectionPreview(tenant,movement)).rejects.toBe(error);expect(mock).toHaveBeenCalledExactlyOnceWith('preview_finance_movement_correction',{_tenant_id:tenant,_movement_id:movement});});
