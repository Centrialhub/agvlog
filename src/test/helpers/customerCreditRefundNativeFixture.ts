import {readFileSync} from 'node:fs';
import {createCustomerCreditRefundDatabase,seedCustomerCreditRefundSource} from './customerCreditRefundDatabase';
export async function prepareCustomerCreditRefundNative(){const db=await createCustomerCreditRefundDatabase();
 // Restore exact captured invoice ACL: this full finance fixture creates the function afresh.
 await db.exec('revoke all on function public.apply_client_invoice_command(jsonb) from public,anon,service_role;grant execute on function public.apply_client_invoice_command(jsonb) to authenticated');
 for(const name of ['20260911103921_finance_customer_credit_public_catalog','20260911104822_finance_customer_credit_recorded_refunds','20260911110629_finance_customer_credit_refund_public_catalog'])await db.exec(readFileSync('supabase/migrations/'+name+'.sql','utf8'));
 const source=await seedCustomerCreditRefundSource(db);await db.exec('commit');return source;}
