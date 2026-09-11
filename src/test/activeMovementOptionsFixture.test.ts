// @vitest-environment node
import {it,expect} from 'vitest';
import {createActiveMovementOptionsDatabase,seedActiveMovementOptionOrigins,activeMovementOptionIds as i} from './helpers/activeMovementOptionsDatabase';
it('compiles the combined candidate dependencies and seeds real source rows',async()=>{const db=await createActiveMovementOptionsDatabase();try{await db.exec('begin');const s=await seedActiveMovementOptionOrigins(db);expect(s.payable).toBeTruthy();
 const calls:[string,unknown[]][]=[
 ["select finance_private.expense_options($1,'movements','',$2,1)",[i.tenant,s.trip]],
 ["select finance_private.manual_expense_movements($1,'',1)",[i.tenant]],
 ["select finance_private.payable_movement_options($1,$2,'',1)",[i.tenant,s.payable]],
 ["select finance_private.receipt_movement_options($1,$2,'2026-01-20','',1)",[i.tenant,i.account]],
 ["select finance_private.legacy_payable_association($1,$2,1)",[i.tenant,s.legacyPayablePayment]],
 ["select finance_private.legacy_receivable_association($1,$2,1)",[i.tenant,s.legacyReceivablePayment]],
 ["select finance_private.get_settlement_payment_movements($1,$2,1)",[i.tenant,s.settlementPayment]],
 ["select finance_private.new_settlement_payment_candidates($1,$2,5000,1)",[i.tenant,s.settlement]]];
 for(const [sql,params] of calls)await db.query(sql,params);await db.exec('rollback');}finally{await db.close();}},30000);
