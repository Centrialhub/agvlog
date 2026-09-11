import {z} from 'zod';
const uuid=z.string().uuid(),date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const internalTransferCommandSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,source_account_id:uuid,destination_account_id:uuid,amount_cents:z.number().int().positive().max(99999999999999),debited_on:date,credited_on:date,source_reference:z.string().max(300).optional(),destination_reference:z.string().max(300).optional(),reason:z.string().trim().min(5).max(2000),both_recorded:z.literal(true)}).strict().refine(p=>p.source_account_id!==p.destination_account_id&&p.credited_on>=p.debited_on);
export type InternalTransferCommand=z.infer<typeof internalTransferCommandSchema>;
export const internalTransferResultSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,transfer_id:uuid,outgoing_id:uuid,incoming_id:uuid,confirmed:z.literal(true),bank_confirmed:z.literal(false)}).refine(r=>r.outgoing_id!==r.incoming_id);
