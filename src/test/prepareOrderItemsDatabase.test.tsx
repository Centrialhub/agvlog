import {readFileSync} from 'node:fs';
import {cleanup,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import ResultsStep from '@/components/ingestion/ResultsStep';
import {prepareOrderItems} from '@/lib/ingestion/prepareOrderItems';
import {createItemPreparationOutbox} from '@/lib/loads/itemPreparationOutbox';
import type {ItemPreparationPayload} from '@/lib/loads/itemPreparation';
import {createItemWriterDatabase,itemWriterIds as i,seedItemWriter} from './helpers/loadItemWriterDatabase';
import {compositionRpc} from './helpers/compositionDatabase';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
// Export providers are unrelated to ingestion result rendering; no export is run.
vi.mock('jspdf',()=>({default:vi.fn()}));vi.mock('jspdf-autotable',()=>({default:vi.fn()}));vi.mock('qrcode',()=>({default:{toDataURL:vi.fn()}}));
let db:PGlite;let sequence:number;let loseAt:number;const send=vi.fn();
const orders=()=>[1,2,3].map(n=>({source:{orderNumber:String(n),clientName:'Cliente QA',quantity:n,palletCount:0,weightKg:2}}));
const controller=()=>createItemPreparationOutbox({storage:localStorage,uuid:()=>[i.request,i.request2,'a0000000-0000-4000-8000-000000000003'][sequence++],changed:()=>{},assertContext:()=>{},lock:async(_key,work)=>work(),send});
beforeAll(async()=>{db=await createItemWriterDatabase();},30000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});afterEach(cleanup);
beforeEach(async()=>{
 await seedItemWriter(db);localStorage.clear();sequence=0;loseAt=-1;send.mockReset();
 send.mockImplementation(async payload=>{
  try{const row=(await compositionRpc(db,'select save_load_item_preparation($1::jsonb) result',[JSON.stringify(payload)])).rows[0] as {result:unknown};
   return {data:send.mock.calls.length===loseAt?{}:row.result,error:null};
  }catch(error){return {data:null,error};}
 });
});
const count=async()=>Number((await db.query<{n:number}>('select count(*)::int n from load_items where load_id=$1',[i.load2])).rows[0].n);
async function run(input=orders()){
 const outbox=controller();return prepareOrderItems({loadId:i.load2,loadNumber:1003,orders:input,orderIds:new Map(),confirmedCount:0,
  submit:(payload:Omit<ItemPreparationPayload,'tenant_id'>)=>outbox.submit(i.tenant,i.operator,{...payload,tenant_id:i.tenant})});
}
describe('ingestion order-item sequence with real outbox/SQL and result component',()=>{
 it('counts only confirmed writes and preserves an explicit zero pallet value',async()=>{
  expect(await run()).toBe(3);expect(await count()).toBe(3);expect(localStorage.length).toBe(0);
  expect((await db.query('select sum(pallet_count)::int n from load_items where load_id=$1',[i.load2])).rows[0]).toEqual({n:0});
 });
 it('stops at a rejected item, retains confirmed cargo and renders partial failure rather than success',async()=>{
  const input=orders();input[1].source.quantity=-1;let failure='';
  try{await run(input);}catch(error){failure=(error as Error).message;}
  expect(failure).toContain('criada parcialmente: 1 item(ns) confirmado(s)');expect(failure).toContain('Pedido 2 sem confirmação');
  expect(await count()).toBe(1);expect(send).toHaveBeenCalledTimes(1);expect(localStorage.length).toBe(0);
  const result='❌ '+failure;render(<MemoryRouter><ResultsStep results={[result]} onReset={()=>{}}/></MemoryRouter>);
  expect(screen.getByText(result)).toHaveClass('text-destructive');
 });
 it('reports a lost second response without losing either committed item or silently starting the third',async()=>{
  loseAt=2;await expect(run()).rejects.toThrow('criada parcialmente: 1 item(ns) confirmado(s)');
  expect(await count()).toBe(2);expect(send).toHaveBeenCalledTimes(2);expect(localStorage.length).toBe(1);const second=send.mock.calls[1][0];
  await controller().recover(i.tenant,i.operator,i.load2+':new');expect(send.mock.calls[2][0]).toEqual(second);expect(await count()).toBe(2);expect(localStorage.length).toBe(0);
 });
 it('keeps the actual Ingestion component routed through this checked sequence and recovery gate',()=>{
  const source=readFileSync('src/pages/Ingestion.tsx','utf8');expect(source).toContain('itemsCreated=await prepareOrderItems(');
  expect(source).toContain('itemPreparations.pending.length');expect(source).not.toContain("supabase.rpc('upsert_load_item_v3'");
 });
});
