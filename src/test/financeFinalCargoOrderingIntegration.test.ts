// @vitest-environment node
import {it,expect} from 'vitest';import {readFileSync} from 'node:fs';import {createFinanceForwardBlockDatabase} from './helpers/financeForwardBlockDatabase';
it('captures cargo-gated final expense reader before190516 and keeps final readiness',async()=>{
const {db}=await createFinanceForwardBlockDatabase('20260910212551',true,true,undefined,async db=>{
const read=(f:string)=>readFileSync('supabase/migrations/'+f,'utf8');
const cargo=read('20260910142606_driver_trip_cargo_custody_cycle.sql').match(/create table public\.trip_cargo_controls \([\s\S]*?\n\);/)?.[0];if(!cargo)throw Error('cargoDDL');await db.exec(cargo);
await db.exec(read('20260910140823_require_matching_active_tenant_claim.sql'));
for(const f of ['20260910211800_canonical_trip_cargo_close_gate.sql','20260910213156_quarantine_legacy_settlements_until_cargo_close.sql','20260910220847_finance_cargo_expense_active_movements.sql'])await db.exec(read(f));
});try{expect((await db.query<{v:{ready:boolean;missing:string[]}}>('select finance_private.movement_correction_readiness() v')).rows[0].v).toMatchObject({ready:true,missing:[]});}finally{await db.close();}
},120000);
