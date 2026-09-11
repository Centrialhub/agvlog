import {z} from 'zod';
import {receivablePaymentSchema} from './receivableCommands';
const uuid=z.string().uuid(),revision=z.string().regex(/^[a-f0-9]{32}$/);
export const receivablePaymentsRequestSchema=z.object({tenantId:uuid,actorId:uuid,receivableId:uuid,page:z.number().int().min(1).max(2147483647),expectedRevision:revision.nullable()}).refine(v=>v.page===1||v.expectedRevision!==null,'Atualize os recebimentos antes de trocar de página.');
export type ReceivablePaymentsRequest=z.infer<typeof receivablePaymentsRequestSchema>;
export const receivablePaymentsPageSchema=z.object({
 version:z.literal(1),tenant_id:uuid,actor_id:uuid,receivable_id:uuid,page:z.number().int().min(1).max(2147483647),page_size:z.literal(50),total:z.number().int().nonnegative().safe(),revision,
 rows:z.array(receivablePaymentSchema.extend({credit_id:uuid.nullable(),allocation_correction:receivablePaymentSchema.shape.allocation_correction.unwrap()})).max(50),
}).superRefine((value,ctx)=>{
 const fail=(message:string)=>ctx.addIssue({code:'custom',message});
 if(value.rows.length!==Math.min(50,Math.max(0,value.total-(value.page-1)*50)))fail('Contagem incompatível com a página de recebimentos.');
 if(new Set(value.rows.map(row=>row.id)).size!==value.rows.length)fail('Recebimento duplicado na página.');
 for(let index=0;index<value.rows.length;index++){
  const row=value.rows[index],time=Date.parse(row.received_at);
  if(!Number.isFinite(time))fail('Data do recebimento inválida.');
  if(index>0){const previous=value.rows[index-1],previousTime=Date.parse(previous.received_at);
   // PostgreSQL timestamps may differ below JavaScript's millisecond precision.
   if(previousTime<time||(previous.received_at===row.received_at&&previous.id>row.id))fail('Ordem dos recebimentos inconsistente.');
  }
 }
});
export type ReceivablePaymentsPage=z.infer<typeof receivablePaymentsPageSchema>;
