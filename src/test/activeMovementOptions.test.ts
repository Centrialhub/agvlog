// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createActiveMovementOptionsDatabase,seedActiveMovementOptionOrigins,activeMovementOptionIds as i} from './helpers/activeMovementOptionsDatabase';
import {financeAs} from './helpers/financeLedgerDatabase';
import {expenseOptionsSchema} from '@/lib/financial/expenseBatchContract';
import {manualExpenseOptionsSchema} from '@/lib/financial/manualExpenseContract';
import {payableMovementOptionsSchema} from '@/lib/financial/payableMovementContract';
import {receiptMovementOptionsSchema} from '@/lib/financial/receivableMovementContract';
import {legacyPayableContextSchema} from '@/lib/financial/legacyPayableAssociationContract';
import {legacyReceivableContextSchema} from '@/lib/financial/legacyReceivableAssociationContract';
import {settlementMovementOptionsSchema} from '@/lib/financial/settlementMovementContract';
import {settlementPaymentCandidatesSchema} from '@/lib/financial/settlementPaymentContract';
let db:Awaited<ReturnType<typeof createActiveMovementOptionsDatabase>>;
let origins:Awaited<ReturnType<typeof seedActiveMovementOptionOrigins>>;
beforeAll(async()=>{db=await createActiveMovementOptionsDatabase();},30000);
beforeEach(async()=>{await db.exec('begin');origins=await seedActiveMovementOptionOrigins(db);});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function movement(direction:'in'|'out',driver=false){const request=randomUUID();const result=(await financeAs<{v:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1) v',[{version:1,tenant_id:i.tenant,request_id:request,bank_account_id:i.account,direction,nature:'other',amount_cents:5000,occurred_on:'2026-01-20',description:'Movimento candidato conferido',beneficiary_name:'Favorecido QA',reason:'Registro para conferir as opções financeiras',...(driver?{driver_id:i.driver}:{})}])).rows[0].v;return{id:result.movement_id,request};}
async function invalidateStorage(m:{id:string;request:string}){const request=randomUUID();await db.query("insert into finance_commands(tenant_id,request_id,actor_id,action,payload,result) values($1,$2,$3,'qa_storage_only','{}','{}')",[i.tenant,request,i.operator]);await db.query(`insert into finance_movement_voids(tenant_id,movement_id,original_request_id,request_id,kind,actor_id,actor_name,reason,revision,source_snapshot)
 values($1,$2,$3,$4,'void',$5,'Financeiro QA','Erro de registro verificado',md5('options QA'),'{"fixture":"owner only"}')`,[i.tenant,m.id,m.request,request,i.operator]);}
function queries(tenant=i.tenant){return[
 {name:'get_finance_expense_options',args:[tenant,'movements','',origins.trip,1],schema:expenseOptionsSchema},
 {name:'get_finance_manual_expense_movements',args:[tenant,'',1],schema:manualExpenseOptionsSchema},
 {name:'get_finance_payable_movements',args:[tenant,origins.payable,'',1],schema:payableMovementOptionsSchema},
 {name:'get_finance_receipt_movement_options',args:[tenant,i.account,'2026-01-20','',1],schema:receiptMovementOptionsSchema},
 {name:'get_finance_legacy_payable_association',args:[tenant,origins.legacyPayablePayment,1],schema:legacyPayableContextSchema},
 {name:'get_finance_legacy_receivable_association',args:[tenant,origins.legacyReceivablePayment,1],schema:legacyReceivableContextSchema},
 {name:'get_finance_settlement_payment_movements',args:[tenant,origins.settlementPayment,1],schema:settlementMovementOptionsSchema},
 {name:'get_finance_settlement_payment_candidates',args:[tenant,origins.settlement,5000,1],schema:settlementPaymentCandidatesSchema},
 ];}
async function read(q:ReturnType<typeof queries>[number]){const raw=(await financeAs<{v:unknown}>(db,i.operator,`select ${q.name}(${q.args.map((_,n)=>`$${n+1}`).join(',')}) v`,q.args)).rows[0].v;return q.schema.parse(raw);}
it('removes voided money from all eight selectors while preserving existing titles and payments',async()=>{
 const movements=[await movement('out'),await movement('out',true),await movement('in')];
 const before=[];for(const q of queries())before.push(await read(q));
 for(let n=0;n<before.length;n++){expect(before[n].total,queries()[n].name).toBeGreaterThan(0);expect(before[n].rows.length).toBeGreaterThan(0);}
 const paymentRows='select * from (select to_jsonb(p) row from payables_payments p union all select to_jsonb(p) from receivables_payments p union all select to_jsonb(p) from driver_settlement_payments p) q order by q.row::text';
 const originalPayments=(await db.query(paymentRows)).rows;
 for(const m of movements)await invalidateStorage(m);
 const after=[];for(const q of queries())after.push(await read(q));for(let n=0;n<after.length;n++)expect(after[n],queries()[n].name).toMatchObject({total:0,rows:[]});
 expect((await db.query(paymentRows)).rows).toEqual(originalPayments);
 expect((await db.query('select count(*)::int n from finance_movements')).rows[0]).toEqual({n:3});
});
it('computes candidate counts over the complete active set across pages',async()=>{
 const movements=[];for(let n=0;n<32;n++)movements.push(await movement('out'));await invalidateStorage(movements[0]);
 const q=queries()[1],first=await read(q),second=await read({...q,args:[i.tenant,'',2]});
 expect(first).toMatchObject({total:31,page:1});expect(second).toMatchObject({total:31,page:2});expect(first.rows).toHaveLength(20);expect(second.rows).toHaveLength(11);
 expect([...first.rows,...second.rows].map(r=>r.id)).not.toContain(movements[0].id);
});
it('denies another tenant and mixed-driver membership for every selector',async()=>{
 await movement('out');for(const q of queries(randomUUID()))await expect(read(q)).rejects.toThrow('finance_access_denied');
 await db.query("insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'driver',true)",[i.tenant,i.operator]);
 for(const q of queries())await expect(read(q)).rejects.toThrow('finance_access_denied');
});
