import {z} from 'zod';
const uuid=z.string().uuid();
export const receiptCorrectionCommandSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,payment_id:uuid,expected_revision:z.string().regex(/^[a-f0-9]{32}$/),reason:z.string().trim().min(10).max(2000)}).strict();
export type ReceiptCorrectionCommand=z.infer<typeof receiptCorrectionCommandSchema>;
export const receiptCorrectionResultSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,payment_id:uuid,correction_id:uuid,movement_id:uuid,confirmed:z.literal(true),cash_changed:z.literal(false)});
