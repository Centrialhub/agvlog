// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {createCustomerCreditApplicationDatabase} from './helpers/customerCreditApplicationDatabase';
import {createInvoiceScenario} from './helpers/clientInvoiceLifecycleDatabase';
import {operationIds as i} from './helpers/operationOutcomeDatabase';
import {parseFinancialContext} from '@/lib/financial/receivableCommands';
it('parses every field of the real credit-aware financial snapshot',async()=>{
 const db=await createCustomerCreditApplicationDatabase();try{
  await db.exec(readFileSync('supabase/migrations/20260911101312_finance_customer_credit_applications.sql','utf8'));
  await db.exec('begin');const scenario=await createInvoiceScenario(db);
  const raw=(await db.query<{value:unknown}>('select public.get_receivable_financial_context($1,$2) value',[i.tenant,scenario.receivable])).rows[0].value;
  const parsed=parseFinancialContext(raw,i.tenant,i.operator,scenario.receivable);
  expect(parsed).toMatchObject({cash_received_cents:0,credit_applied_cents:0,settled_cents:0,credit_application_count:0});
  expect(parsed.credit_revision).toMatch(/^[a-f0-9]{32}$/);
  expect(parsed.open_cents).toBe(parsed.amount_cents);
 }finally{await db.close();}
},30000);
