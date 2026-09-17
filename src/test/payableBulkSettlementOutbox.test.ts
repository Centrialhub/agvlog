import {afterEach,expect,it,vi} from 'vitest';
import {payableBulkStorageKey,type PayableBulkCommand,type PayableBulkResult} from '@/lib/financial/payableBulkSettlementContract';
import {createPayableBulkSettlementOutbox,lockPayableBulkSettlement,pendingPayableBulkSettlement,type PayableBulkSettlementRequest} from '@/lib/financial/payableBulkSettlementOutbox';

const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),movement=crypto.randomUUID(),account=crypto.randomUUID(),payableA=crypto.randomUUID(),payableB=crypto.randomUUID();
const requestId=crypto.randomUUID();
const command:PayableBulkCommand={version:1,tenant_id:tenant,request_id:requestId,movement_id:movement,bank_account_id:account,paid_on:'2026-09-14',expected_revision:'a'.repeat(32),items:[{payable_id:payableA,amount_cents:'12000'},{payable_id:payableB,amount_cents:'8000'}],method:'pix',reason:'  Conferência do pagamento agrupado  '};
const context={version:1 as const,tenant_id:tenant,actor_id:actor,movement:{id:movement,bank_account_id:account,account_name:'Banco QA',occurred_on:'2026-09-14',beneficiary_name:'Fornecedor QA',bank_reference:'PIX-200',description:'Pagamento agrupado',receipt_path:null,amount_cents:'20000',remaining_cents:'20000'},items:[{payable_id:payableA,supplier_id:null,supplier_name:'Fornecedor QA',description:'Nota A',status:'approved',driver_id:null,nominal_cents:'12000',paid_cents:'0',remaining_cents:'12000',amount_cents:'12000',eligible:true,issue:null},{payable_id:payableB,supplier_id:null,supplier_name:'Fornecedor QA',description:'Nota B',status:'approved',driver_id:null,nominal_cents:'8000',paid_cents:'0',remaining_cents:'8000',amount_cents:'8000',eligible:true,issue:null}],total_cents:'20000',blockers:[],eligible:true,expected_revision:'a'.repeat(32)};
const request:PayableBulkSettlementRequest={command,context};
const result=(payload:PayableBulkCommand):PayableBulkResult=>({version:1,tenant_id:tenant,actor_id:actor,request_id:payload.request_id,movement_id:movement,bank_account_id:account,paid_on:'2026-09-14',total_cents:'20000',rows:[{payable_id:payableA,payment_id:crypto.randomUUID(),link_id:crypto.randomUUID(),amount_cents:'12000'},{payable_id:payableB,payment_id:crypto.randomUUID(),link_id:crypto.randomUUID(),amount_cents:'8000'}],bank_confirmation:'not_evaluated',cash_created:false,confirmed:true});
const directLock=async<T>(_key:string,work:()=>Promise<T>)=>work();
function box(send:(payload:PayableBulkCommand,actorId:string)=>Promise<PayableBulkResult>,assertContext=vi.fn()){
  return createPayableBulkSettlementOutbox({storage:localStorage,assertContext,changed:vi.fn(),lock:directLock,send,isDefinitive:()=>false});
}

afterEach(()=>{localStorage.clear();vi.restoreAllMocks();try{delete (navigator as {locks?:LockManager}).locks;}catch{/* JSDOM property may not be configurable. */}});

it('replays the exact request id and payload from durable storage after a reload',async()=>{
  const firstSend=vi.fn(async()=>{throw new Error('lost response');});
  await expect(box(firstSend).submit(tenant,actor,request)).rejects.toThrow('lost response');
  const raw=localStorage.getItem(payableBulkStorageKey(tenant,actor));
  expect(raw).not.toBeNull();
  expect(pendingPayableBulkSettlement(localStorage,tenant,actor)?.payload.command).toEqual(command);
  const secondSend=vi.fn(async payload=>result(payload));
  await expect(box(secondSend).recover(tenant,actor)).resolves.toMatchObject({request_id:requestId,confirmed:true});
  expect(secondSend).toHaveBeenCalledWith(JSON.parse(raw!).payload.command,actor);
  expect(secondSend.mock.calls[0][0]).toEqual(command);
  expect(localStorage.getItem(payableBulkStorageKey(tenant,actor))).toBeNull();
});

it('serializes concurrent work with the in-process fallback and uses navigator locks when available',async()=>{
  const order:string[]=[];let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const first=lockPayableBulkSettlement('bulk-lock',async()=>{order.push('first-start');await gate;order.push('first-end');return 1;});
  const second=lockPayableBulkSettlement('bulk-lock',async()=>{order.push('second-start');return 2;});
  await vi.waitFor(()=>expect(order).toEqual(['first-start']));
  release();expect(await Promise.all([first,second])).toEqual([1,2]);expect(order).toEqual(['first-start','first-end','second-start']);
  const requestLock=vi.fn(async(_key:string,work:()=>Promise<number>)=>work());
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:requestLock}});
  await expect(lockPayableBulkSettlement('native-lock',async()=>3)).resolves.toBe(3);
  expect(requestLock).toHaveBeenCalledWith('native-lock',expect.any(Function));
});

it('keeps the original tenant and actor request when context changes during transport',async()=>{
  const currentTenant=tenant;let currentActor=actor;
  const assertContext=vi.fn((expectedTenant:string,expectedActor:string)=>{if(expectedTenant!==currentTenant||expectedActor!==currentActor)throw new Error('Recupere o pedido na sessão original.');});
  const send=vi.fn(async payload=>{currentActor=crypto.randomUUID();return result(payload);});
  await expect(box(send,assertContext).submit(tenant,actor,request)).rejects.toThrow('sessão original');
  expect(pendingPayableBulkSettlement(localStorage,tenant,actor)?.payload.command).toEqual(command);
  expect(pendingPayableBulkSettlement(localStorage,currentTenant,currentActor)).toBeNull();
});

it('does not erase a record replaced by another tab while the original request is in flight',async()=>{
  const key=payableBulkStorageKey(tenant,actor);
  const foreignRequestId=crypto.randomUUID();
  const send=vi.fn(async payload=>{const foreign=JSON.parse(localStorage.getItem(key)!);foreign.payload.command.request_id=foreignRequestId;localStorage.setItem(key,JSON.stringify(foreign));return result(payload);});
  await box(send).submit(tenant,actor,request);
  expect(JSON.parse(localStorage.getItem(key)!).payload.command.request_id).toBe(foreignRequestId);
  expect(send).toHaveBeenCalledWith(command,actor);
});
