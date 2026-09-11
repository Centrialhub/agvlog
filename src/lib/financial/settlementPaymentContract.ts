import {z} from 'zod';
const uuid=z.string().uuid(),cents=z.number().int().positive().max(99999999999999);
export const settlementPaymentCommandSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,settlement_id:uuid,movement_id:uuid,amount_cents:cents,method:z.enum(['pix','ted','cash','other']),reason:z.string().trim().min(10).max(2000)}).strict();
export type SettlementPaymentCommand=z.infer<typeof settlementPaymentCommandSchema>;
export const settlementPaymentResultSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,payment_id:uuid,settlement_id:uuid,movement_id:uuid,link_id:uuid,amount_cents:cents,cash_created:z.literal(false),confirmed:z.literal(true)});
export const settlementPaymentCandidatesSchema=z.object({version:z.literal(1),tenant_id:uuid,settlement_id:uuid,amount_cents:cents,balance_cents:z.number().int().nonnegative().max(99999999999999),page:z.number().int().positive(),page_size:z.literal(20),total:z.number().int().nonnegative(),rows:z.array(z.object({id:uuid,description:z.string(),occurred_on:z.string(),amount_cents:cents,remaining_cents:cents,beneficiary_name:z.string(),account_name:z.string()})).max(20)});
