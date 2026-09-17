// @vitest-environment node
import {randomUUID} from 'node:crypto';import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';import {legacyInventorySchema} from '../lib/financial/legacyInventoryClient';
import {it,expect,vi} from 'vitest';import {writeFileSync} from 'node:fs';import {createFinanceForwardBlockDatabase} from './helpers/financeForwardBlockDatabase';
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
it('installs all twelve next financial files on the current fresh predecessor chain',async()=>{const bank=randomUUID(),title=randomUUID(),paid=randomUUID(),tx=randomUUID();const {db,applied}=await createFinanceForwardBlockDatabase('20260910152558',true,true,async db=>{await db.query("insert into bank_accounts(id,tenant_id,name,account_type) values($1,$2,'Banco QA','checking')",[bank,i.tenant]);
await db.query("insert into payables(id,tenant_id,supplier_name,category,description,amount,due_date,status) values($1,$2,'Fornecedor antigo','other','Pagamento legado',30,'2026-01-20','approved')",[title,i.tenant]);
await db.query("insert into bank_transactions(id,tenant_id,bank_account_id,posted_at,amount,transaction_type,raw_payload) values($1,$2,$3,'2026-01-20T12:00:00Z',30,'debit','{}')",[tx,i.tenant,bank]);
await db.query("insert into payables_payments(id,tenant_id,payable_id,amount,paid_at,bank_account_id,method,bank_transaction_id,created_by) values($1,$2,$3,30,'2026-01-20T12:00:00Z',$4,'pix',$5,$6)",[paid,i.tenant,title,bank,tx,i.operator]);
});try{writeFileSync('docs/qa/finance-forward-third-block-manifest-2026-09-11.json',JSON.stringify(applied,null,2));expect(applied.at(-1)?.file).toContain('20260910152557');
await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);
const cash=randomUUID(),payment=randomUUID();await db.query("insert into bank_accounts(id,tenant_id,name,account_type) values($1,$2,'Caixa QA','cash')",[cash,i.tenant]);
const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),account_id:cash,effective_from:'2026-01-01',custodian_name:'Responsável QA',reason:'Contagem inicial conferida',counts:[{denomination_cents:10000,quantity:2}]};
const opening=async()=>(await operationRpc<{v:Record<string,unknown>}>(db,'select record_finance_cash_opening($1::jsonb) v',[JSON.stringify(payload)])).rows[0].v;
const first=await opening();expect(first).toMatchObject({balance_cents:'20000',cash_created:false});expect(await opening()).toEqual(first);
const report=(await operationRpc<{v:Record<string,unknown>}>(db,'select get_finance_account_opening($1,$2,$3,$4) v',[i.tenant,cash,'2026-01-02','2026-01-31'])).rows[0].v;expect(report).toMatchObject({book:{opening_cents:'20000',closing_cents:'20000'},can_close:false});expect((await db.query('select * from finance_movements')).rows).toHaveLength(0);
await db.query("insert into load_payments(id,tenant_id,load_id,amount,payment_date,bank_account_id) values($1,$2,$3,37,'2026-01-20',$4)",[payment,i.tenant,i.load,bank]);
const inventory=legacyInventorySchema.parse((await operationRpc<{v:unknown}>(db,'select get_finance_legacy_adoption_inventory($1,$2,$3,$4,1) v',[i.tenant,bank,'2026-01-01','2026-01-31'])).rows[0].v);expect(inventory.rows.some(r=>r.source_id===payment&&r.source_table==='load_payments'&&r.bank_transaction_id===null)).toBe(true);expect(inventory.can_close).toBe(false);

const movement=(await operationRpc<{v:{movement_id:string}}>(db,'select record_finance_movement($1::jsonb) v',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:bank,direction:'out',nature:'payment',amount_cents:3000,occurred_on:'2026-01-20',description:'Saída já realizada',beneficiary_name:'Fornecedor antigo',reason:'Registro da transferência efetuada'})])).rows[0].v.movement_id;
const revision=(await db.query<{v:string}>('select finance_private.legacy_payable_source_revision($1,$2) v',[i.tenant,paid])).rows[0].v;
const before=(await db.query('select * from payables_payments where id=$1',[paid])).rows;
const linked=(await operationRpc<{v:{link_id:string}}>(db,'select associate_finance_legacy_payable_payment($1::jsonb) v',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),payment_id:paid,movement_id:movement,revision,reason:'Associação documental por identificadores'})])).rows[0].v;
await operationRpc(db,'select reverse_finance_legacy_payable_association($1::jsonb)',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),link_id:linked.link_id,reason:'Revisão manual da associação'})]);
expect((await db.query('select * from payables_payments where id=$1',[paid])).rows).toEqual(before);expect((await db.query('select * from finance_movements')).rows).toHaveLength(1);
await db.exec('set constraints all immediate');await db.exec('rollback');}finally{await db.close();}},120000);
