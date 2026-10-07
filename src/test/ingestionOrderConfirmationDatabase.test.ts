// @vitest-environment node
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {createConfirmedOrderLoad,prepareOrderItems} from '@/lib/ingestion/prepareOrderItems';
// Real unique/FK failures and real writes, wholly in an ephemeral fixture.
let db:PGlite;const tenant='10000000-0000-4000-8000-000000000001';
const row=(number='CSV-1')=>({source:{orderNumber:number,clientName:'QA',quantity:1.5,palletCount:2,weightKg:100.25}});
beforeAll(async()=>{db=new PGlite();await db.exec(`create table orders(id uuid primary key default gen_random_uuid(),tenant_id uuid,number text,unique(tenant_id,number));create table loads(id uuid primary key default gen_random_uuid());create table items(load_id uuid references loads,order_id uuid not null references orders,quantity numeric,pallet_count numeric,weight_kg numeric);`);},30000);
afterAll(async()=>{await db.close();});beforeEach(async()=>{await db.exec('truncate items,loads,orders;');});
async function insert(number:string){return (await db.query<{id:string}>('insert into orders(tenant_id,number) values($1,$2) returning id',[tenant,number])).rows[0].id;}
async function create(orders:ReturnType<typeof row>[],ids:Map<string,string>){
 const load=await createConfirmedOrderLoad(orders,ids,async()=>(await db.query<{id:string}>('insert into loads default values returning id')).rows[0]);
 return prepareOrderItems({loadId:load.id,loadNumber:1,orders,orderIds:ids,confirmedCount:0,submit:async payload=>{
  const v=payload.values;await db.query('insert into items values($1,$2,$3,$4,$5)',[load.id,v.order_id,v.quantity,v.pallet_count,v.weight_kg]);return {} as never;
 }});
}
describe('CSV load creation requires confirmed order identities',()=>{
 it('rejects a repeated CSV before creating another load or an orphan item',async()=>{
  const orders=[row()],id=await insert('CSV-1');expect(await create(orders,new Map([['CSV-1',id]]))).toBe(1);
  await expect(insert('CSV-1')).rejects.toThrow('duplicate key');await expect(create(orders,new Map())).rejects.toThrow('Carga não criada');
  expect((await db.query('select (select count(*)::int from orders) orders,(select count(*)::int from loads) loads,(select count(*)::int from items) items')).rows[0]).toEqual({orders:1,loads:1,items:1});
  expect((await db.query('select order_id,quantity,pallet_count,weight_kg from items')).rows[0]).toEqual({order_id:id,quantity:'1.5',pallet_count:'2',weight_kg:'100.25'});
 });
 it('blocks a partial group but continues an independent fully confirmed group',async()=>{
  const id=await insert('CSV-2');await expect(create([row('CSV-1'),row('CSV-2')],new Map([['CSV-2',id]]))).rejects.toThrow('CSV-1');
  expect(await create([row('CSV-2')],new Map([['CSV-2',id]]))).toBe(1);expect((await db.query('select count(*)::int n from loads')).rows[0]).toEqual({n:1});
 });
 it('rejects duplicate identities before load creation or any item submission',async()=>{
  const id=await insert('CSV-1'),orders=[row(),row()],ids=new Map([['CSV-1',id]]),submit=vi.fn();
  await expect(create(orders,ids)).rejects.toThrow('criação única');await expect(prepareOrderItems({loadId:tenant,loadNumber:1,orders,orderIds:ids,confirmedCount:0,submit})).rejects.toThrow('criação única');expect(submit).not.toHaveBeenCalled();
 });
 it('routes the actual Ingestion creator through the pre-creation guard',()=>{
  const source=readFileSync('src/pages/Ingestion.tsx','utf8');expect(source).toContain('createConfirmedOrderLoad(suggestion.orders,createdOrderIds,()=>createLoad.mutateAsync(');expect(source).not.toContain('const createdLoad = await createLoad.mutateAsync(');
 });
});
