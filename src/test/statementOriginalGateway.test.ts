import {describe,expect,it,vi} from 'vitest';
import {originalHash,preserveStatementOriginal,statementFileType} from '../../supabase/functions/secure-upload/statement-original';
const tenant='10000000-0000-4000-8000-000000000001',bytes=new TextEncoder().encode('Data;Valor\n01/01/2026;-500,00');
describe('statement original retention gateway',()=>{
  it('computes identity from actual bytes and stores the original without overwriting',async()=>{
    const upload=vi.fn().mockResolvedValue({error:null}),download=vi.fn();
    const result=await preserveStatementOriginal(tenant,'extrato.csv',bytes,{upload,download});
    expect(result.path).toBe(`${tenant}/imports/${await originalHash(bytes)}.csv`);
    expect(upload).toHaveBeenCalledWith(result.path,bytes,'text/csv');expect(download).not.toHaveBeenCalled();
  });
  it('recovers a repeated upload only after checking the stored bytes',async()=>{
    const upload=vi.fn().mockResolvedValue({error:new Error('object exists or reply lost')}),download=vi.fn().mockResolvedValue(bytes);
    const result=await preserveStatementOriginal(tenant,'outro-nome.csv',bytes,{upload,download});
    expect(download).toHaveBeenCalledWith(result.path);expect(result.sha256).toBe(await originalHash(bytes));
  });
  it('does not claim success when a failed upload cannot be verified',async()=>{
    await expect(preserveStatementOriginal(tenant,'extrato.csv',bytes,{upload:async()=>({error:'network'}),download:async()=>new Uint8Array([1,2,3])})).rejects.toThrow('storage_unconfirmed');
  });
  it('requires compatible signatures and readable UTF-8 CSV content',()=>{
    expect(statementFileType('extrato.xlsx',bytes)).toBeNull();
    expect(statementFileType('extrato.csv',new Uint8Array([0xff,0xfe,0x00]))).toBeNull();
    expect(statementFileType('extrato.exe',bytes)).toBeNull();
    expect(statementFileType('extrato.csv',bytes)?.mime).toBe('text/csv');
  });
});
