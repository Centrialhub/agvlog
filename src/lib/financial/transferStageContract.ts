import {z} from 'zod';
const uuid=z.string().uuid(),cents=z.number().int().positive().max(99999999999999);
const common={version:z.literal(1),tenant_id:uuid,request_id:uuid,occurred_on:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),bank_reference:z.string().max(300).optional(),reason:z.string().trim().min(5).max(2000),occurred:z.literal(true)};
export const transferStageCommandSchema=z.discriminatedUnion('stage',[
 z.object({...common,stage:z.literal('depart'),source_account_id:uuid,destination_account_id:uuid,amount_cents:cents}).strict(),
 z.object({...common,stage:z.literal('arrive'),departure_id:uuid}).strict(),
]);
export type TransferStageCommand=z.infer<typeof transferStageCommandSchema>;
export type PendingTransfer=z.infer<typeof pendingTransfersSchema>['rows'][number];
export const transferStageResultSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,stage:z.enum(['depart','arrive']),departure_id:uuid,movement_id:uuid,transfer_id:uuid.nullable(),confirmed:z.literal(true),bank_confirmed:z.literal(false)}).refine(r=>r.stage==='depart'?r.transfer_id===null:r.transfer_id!==null);
export const pendingTransfersSchema=z.object({version:z.literal(1),tenant_id:uuid,page:z.number().int().positive(),page_size:z.literal(20),total:z.number().int().nonnegative(),amount_cents:z.string().regex(/^\d+$/),rows:z.array(z.object({id:uuid,outgoing_id:uuid,amount_cents:cents,occurred_on:z.string(),destination_account_id:uuid,source_account_id:uuid,source_name:z.string(),destination_name:z.string(),bank_reference:z.string().nullable(),created_by:uuid,created_at:z.string()})).max(20)});
