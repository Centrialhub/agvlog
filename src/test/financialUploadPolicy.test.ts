import {describe,expect,it,vi} from 'vitest';
import {financialReceiptProbe,isFinancialReceiptFolder} from '../../supabase/functions/secure-upload/financial-upload-policy';
describe('financial receipt upload boundary',()=>{
  it('covers known financial roots without classifying delivery proofs as financial',()=>{
    for(const root of ['finance-batches','expense-receipts','payable-payments','receivable-payments','payables'])expect(isFinancialReceiptFolder('receipts',`${root}/file`)).toBe(true);
    expect(isFinancialReceiptFolder('receipts','deliveries/trip/stop')).toBe(false);expect(isFinancialReceiptFolder('occurrence-return-proofs','payables')).toBe(false);
  });
  it('rechecks access at each receipt probe and does not inspect evidence after revocation',async()=>{
    const auth=vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),inspect=vi.fn().mockResolvedValue({data:{uploaded:false},error:null});
    expect(await financialReceiptProbe(auth,inspect)).toEqual({data:{uploaded:false},error:null});
    expect(await financialReceiptProbe(auth,inspect)).toEqual({data:null,error:{message:'finance_access_denied'}});expect(inspect).toHaveBeenCalledTimes(1);
  });
});
