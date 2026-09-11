import {beforeEach,it,expect,vi} from 'vitest';
const send=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/financial/expenseArtifactClient',async original=>{const real=await original<typeof import('@/lib/financial/expenseArtifactClient')>();return {...real,sendExpenseArtifact:send};});
import {attachExpenseArtifact,loadExpenseArtifactPending,expenseArtifactKey} from '@/lib/financial/expenseArtifactOutbox';
import {ExpenseArtifactRejectedError} from '@/lib/financial/expenseArtifactClient';
const tenant='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',expense='33333333-3333-4333-8333-333333333333',artifact='44444444-4444-4444-8444-444444444444';
beforeEach(()=>{localStorage.clear();send.mockReset();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,_options:unknown,work:()=>Promise<unknown>)=>work()}});});
it('replays identical command after unknown response and retains recovery after a later rejection',async()=>{
 send.mockRejectedValueOnce(new Error('lost')).mockRejectedValueOnce(new ExpenseArtifactRejectedError('rejected'));
 await expect(attachExpenseArtifact(tenant,actor,expense,{artifact,reason:'Comprovante recebido'})).rejects.toThrow('lost');
 await expect(attachExpenseArtifact(tenant,actor,expense)).rejects.toThrow('rejected');
 expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0]);expect(loadExpenseArtifactPending(tenant,actor,expense)?.uncertain).toBe(true);
});
it('allows a fresh revision after known first rejection, but never overwrites corrupt pending data',async()=>{
 send.mockRejectedValue(new ExpenseArtifactRejectedError('rejected'));
 await expect(attachExpenseArtifact(tenant,actor,expense,{artifact,reason:'Comprovante recebido'})).rejects.toThrow();expect(loadExpenseArtifactPending(tenant,actor,expense)).toBeNull();
 send.mockClear();localStorage.setItem(expenseArtifactKey(tenant,actor,expense),'{corrupt');
 await expect(attachExpenseArtifact(tenant,actor,expense,{artifact,reason:'Comprovante recebido'})).rejects.toThrow('inconsistente');expect(send).not.toHaveBeenCalled();
});
it('does not erase an outbox changed by another window after confirmation',async()=>{
 send.mockImplementation(async()=>{localStorage.setItem(expenseArtifactKey(tenant,actor,expense),'other-window');return {confirmed:true};});
 await expect(attachExpenseArtifact(tenant,actor,expense,{artifact,reason:'Comprovante recebido'})).resolves.toEqual({confirmed:true});
 expect(localStorage.getItem(expenseArtifactKey(tenant,actor,expense))).toBe('other-window');
});
