// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';

// Complementary disposable SQL graph. Actual predecessor, RPC, admin helper,
// immutability migration and native balance constraints are executed. Hosted
// Auth/RLS parity, real concurrent sessions and the full A5 UI remain native gates.
const fixtureModule='../../scripts/stock-balance-fixture.mjs';
const forward=readFileSync('supabase/migrations/20261005190000_fix_inventory_outbound_balance_update.sql','utf8');
const i={tenant:'10000000-0000-4000-8000-000000000001',otherTenant:'10000000-0000-4000-8000-000000000002',actor:'20000000-0000-4000-8000-000000000001',otherActor:'20000000-0000-4000-8000-000000000002',otherLocation:'30000000-0000-4000-8000-000000000002',otherClient:'40000000-0000-4000-8000-000000000002',otherDocument:'50000000-0000-4000-8000-000000000002'};
let db:PGlite;
const payload=(overrides:Record<string,unknown>={})=>({tenant_id:i.tenant,request_id:randomUUID(),movement_type:'inbound',item_description:'Caixa',quantity:10,pallet_count:2,weight_kg:20,volume_m3:1,moved_at:'2026-10-05T17:00:00Z',...overrides});
async function guarded(sql:string){
 await db.exec('savepoint outbound_case');
 try{const result=await db.exec(sql);await db.exec('release savepoint outbound_case');return result;}
 catch(error){await db.exec('rollback to savepoint outbound_case;release savepoint outbound_case');throw error;}
}
async function call(p:Record<string,unknown>,actor=i.actor){
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
 await db.exec('savepoint outbound_rpc;set role authenticated;');
 try{const result=await db.query<{result:{id:string}}>('select public.create_inventory_movement_v1($1::jsonb) result',[JSON.stringify(p)]);await db.exec('reset role;release savepoint outbound_rpc');return result.rows[0].result;}
 catch(error){await db.exec('rollback to savepoint outbound_rpc;reset role;release savepoint outbound_rpc');throw error;}
}
const state=async()=>({balances:(await db.query('select * from public.inventory_balances order by id')).rows,movements:(await db.query('select * from public.inventory_movements order by id')).rows});
const catalog=async()=>({
 metadata:(await db.query("select to_jsonb(f)-'prosrc' metadata from pg_proc f where oid='public.update_inventory_balance()'::regprocedure")).rows,
 constraints:(await db.query("select to_jsonb(c) value from pg_constraint c where conrelid in('public.inventory_balances'::regclass,'public.inventory_movements'::regclass) order by oid")).rows,
 triggers:(await db.query("select to_jsonb(t) value from pg_trigger t where tgrelid in('public.inventory_balances'::regclass,'public.inventory_movements'::regclass) order by oid")).rows,
 policies:(await db.query("select * from pg_policies where schemaname='public' and tablename in('inventory_balances','inventory_movements') order by tablename,policyname")).rows,
 rpc:(await db.query("select to_jsonb(f) value from pg_proc f where oid='public.create_inventory_movement_v1(jsonb)'::regprocedure")).rows,
});
const body=async()=>(await db.query<{body:string}>("select prosrc body from pg_proc where oid='public.update_inventory_balance()'::regprocedure")).rows[0].body;
const apply=()=>guarded(forward);
beforeAll(async()=>{const {buildStockBalanceFixture}=await import(fixtureModule);db=new PGlite();await db.waitReady;await db.exec(buildStockBalanceFixture().sql);});
beforeEach(async()=>{await db.exec('begin');});
afterEach(async()=>{await db.exec('rollback');});
afterAll(async()=>{await db.close();});

it('reproduces negative INSERT CHECK failure then executes a valid OUT with all dimensions and stable first inbound',async()=>{
 const incoming=payload(),outgoing=payload({movement_type:'outbound',quantity:3,pallet_count:1,weight_kg:6,volume_m3:.3,moved_at:'2026-10-05T18:00:00Z'});
 await call(incoming);const before=await state();
 await expect(call(outgoing)).rejects.toMatchObject({code:'23514',constraint:'inventory_balances_dimensions_nonnegative'});
 expect(await state()).toEqual(before);const contract=await catalog();await apply();expect(await catalog()).toEqual(contract);
 await call(outgoing);
 expect((await db.query('select quantity,pallet_count,weight_kg,volume_m3,first_inbound_at,last_movement_at from inventory_balances')).rows).toEqual([{quantity:'7',pallet_count:1,weight_kg:'14',volume_m3:'0.7',first_inbound_at:new Date('2026-10-05T17:00:00Z'),last_movement_at:new Date('2026-10-05T18:00:00Z')}]);
 expect((await state()).movements).toHaveLength(2);
});

it('replays one OUT request once and rejects a changed payload without any extra effect',async()=>{
 await apply();await call(payload());const out=payload({movement_type:'outbound',quantity:3,pallet_count:1,weight_kg:6,volume_m3:.3});
 const first=await call(out),before=await state();expect((await call(out)).id).toBe(first.id);expect(await state()).toEqual(before);
 await expect(call({...out,quantity:4})).rejects.toMatchObject({code:'23505',message:'inventory_request_conflict'});expect(await state()).toEqual(before);
});

it.each([['quantity',11],['pallet_count',3],['weight_kg',21],['volume_m3',2]] as const)('rejects insufficient %s and preserves every movement, balance and timestamp',async(field,value)=>{
 await apply();await call(payload());const before=await state();
 await expect(call(payload({movement_type:'outbound',quantity:1,pallet_count:0,weight_kg:0,volume_m3:0,[field]:value}))).rejects.toMatchObject({code:'23514',message:'insufficient_inventory_balance'});
 expect(await state()).toEqual(before);
});

it('rejects OUT against an absent nullable logical key then permits a later retry after real inbound',async()=>{
 await apply();const out=payload({movement_type:'outbound',quantity:3,pallet_count:1,weight_kg:6,volume_m3:.3});const before=await state();
 await expect(call(out)).rejects.toMatchObject({code:'23514',message:'insufficient_inventory_balance'});expect(await state()).toEqual(before);
 await call(payload());await call(out);const snapshot=await state();await call(out);expect(await state()).toEqual(snapshot);expect(snapshot.balances).toHaveLength(1);expect(snapshot.movements).toHaveLength(2);
});

it('executes both adjustment directions and rejects missing direction before enabling a decrease',async()=>{
 await apply();await call(payload());
 await call(payload({movement_type:'adjustment',adjustment_direction:'decrease',quantity:3,pallet_count:1,weight_kg:6,volume_m3:.3}));
 await call(payload({movement_type:'adjustment',adjustment_direction:'increase',quantity:2,pallet_count:1,weight_kg:4,volume_m3:.2}));
 expect((await db.query('select quantity,pallet_count,weight_kg,volume_m3 from inventory_balances')).rows).toEqual([{quantity:'9',pallet_count:2,weight_kg:'18',volume_m3:'0.9'}]);
 const before=await state();await expect(call(payload({movement_type:'adjustment',quantity:1}))).rejects.toMatchObject({code:'22023',message:'inventory_adjustment_direction_required'});expect(await state()).toEqual(before);
 await expect(call(payload({movement_type:'adjustment',adjustment_direction:'invalid',quantity:1}))).rejects.toMatchObject({code:'23514',constraint:'inventory_adjustment_direction'});expect(await state()).toEqual(before);
});

it.each(['location_id','client_id','fiscal_document_id'] as const)('rejects a foreign-tenant %s without stock effects',async field=>{
 await apply();const refs={location_id:i.otherLocation,client_id:i.otherClient,fiscal_document_id:i.otherDocument},before=await state();
 await expect(call(payload({[field]:refs[field]}))).rejects.toMatchObject({code:'23503'});expect(await state()).toEqual(before);
});

it('preserves administrator and tenant authorization, RLS visibility and immutable history',async()=>{
 await apply();await call(payload());const before=await state();
 await expect(call(payload(),i.otherActor)).rejects.toMatchObject({code:'42501'});
 await expect(call(payload({tenant_id:i.otherTenant}))).rejects.toMatchObject({code:'42501'});
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.otherActor]);await db.exec('set role authenticated');
 expect((await db.query('select * from public.inventory_movements')).rows).toEqual([]);await db.exec('reset role');
 await expect(guarded("update public.inventory_movements set quantity=20")).rejects.toMatchObject({code:'55000',message:'inventory_movement_history_is_immutable'});
 await expect(guarded('delete from public.inventory_movements')).rejects.toMatchObject({code:'55000',message:'inventory_movement_history_is_immutable'});expect(await state()).toEqual(before);
});

it('changes no catalog, permission or balance data on a second forward attempt',async()=>{
 await apply();await call(payload());const before=await state(),contract=await catalog(),source=await body();
 await expect(apply()).rejects.toMatchObject({code:'55000',message:'inventory_outbound_predecessor_changed'});
 expect(await catalog()).toEqual(contract);expect(await state()).toEqual(before);expect(await body()).toBe(source);
});

it('rejects a divergent predecessor without broadening the accepted body fingerprints',async()=>{
 const source=await body();await db.exec("do $$declare p oid:='public.update_inventory_balance()'::regprocedure;begin execute replace(pg_get_functiondef(p),(select prosrc from pg_proc where oid=p),(select prosrc||E'\\n-- drift' from pg_proc where oid=p));end$$;");
 const drift=await body(),contract=await catalog();expect(drift).not.toBe(source);
 await expect(apply()).rejects.toMatchObject({code:'55000',message:'inventory_outbound_predecessor_changed'});expect(await body()).toBe(drift);expect(await catalog()).toEqual(contract);
});

it.each(['trg_inventory_movement_balance','guard_inventory_movement_history'] as const)('rejects a false WHEN predicate in %s instead of preserving disabled business enforcement',async name=>{
 await db.exec('drop trigger '+name+' on public.inventory_movements;create trigger '+name+(name==='trg_inventory_movement_balance'?' after insert':' before update or delete')+' on public.inventory_movements for each row when(false) execute function public.'+(name==='trg_inventory_movement_balance'?'update_inventory_balance':'guard_inventory_movement_history')+'()');
 const contract=await catalog(),source=await body();await expect(apply()).rejects.toMatchObject({code:'55000',message:'inventory_outbound_balance_contract_changed'});expect(await catalog()).toEqual(contract);expect(await body()).toBe(source);
});
