import {z} from 'zod';
export const receiptMovementOptionsSchema=z.object({version:z.literal(1),tenant_id:z.string().guid(),bank_account_id:z.string().guid(),date:z.string(),page:z.number().int().positive(),page_size:z.literal(20),total:z.number().int().nonnegative(),
 rows:z.array(z.object({id:z.string().guid(),description:z.string(),counterparty:z.string(),amount_cents:z.string().regex(/^\d+$/),available_cents:z.string().regex(/^\d+$/),bank_reference:z.string().nullable()}))});
