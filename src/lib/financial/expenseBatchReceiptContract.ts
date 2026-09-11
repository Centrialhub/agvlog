import {z} from 'zod';
const uuid=z.string().uuid();
export const expenseReceiptIntentCommandSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,batch_request_id:uuid,expense_id:uuid,context:z.enum(['trip','office','personnel','maintenance','other']),trip_id:uuid.nullable(),stop_id:uuid.nullable()}).strict().refine(v=>v.context==='trip'?!!v.trip_id:v.trip_id===null&&v.stop_id===null);
export const expenseReceiptIntentResultSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,batch_request_id:uuid,expense_id:uuid,context:z.enum(['trip','office','personnel','maintenance','other']),trip_id:uuid.nullable(),stop_id:uuid.nullable(),actor_id:uuid,intent_id:uuid}).strict();
