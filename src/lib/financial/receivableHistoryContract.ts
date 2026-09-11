import {z} from 'zod';

const uuid=z.string().uuid();
const timestamp=z.string().datetime({offset:true});
const positiveInteger=z.string().regex(/^[1-9]\d*$/);
const cents=z.string().regex(/^(0|[1-9]\d*)$/);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
 const parsed=new Date(`${value}T00:00:00Z`);
 return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
},'Data inválida.');
const source=z.object({order_id:uuid.nullable(),fiscal_document_id:uuid.nullable(),load_id:uuid.nullable(),client_invoice_id:uuid.nullable(),closing_report_id:uuid.nullable()});
export const receivableHistorySnapshotSchema=z.object({
 description:z.string().nullable(),invoice_number:z.string().nullable(),status:z.string().nullable(),due_date:date.nullable(),
 amount_cents:cents.nullable(),received_cents:cents.nullable(),client_id:uuid.nullable(),
 payer:z.object({id:uuid,tenant_id:uuid,company_name:z.string().nullable()}).nullable(),source,issues:z.array(z.string()),
});
const fields=['description','invoice_number','status','due_date','amount_cents','received_cents','client_id','payer','source','issues'] as const;
const eventSchema=z.object({
 event_order:positiveInteger,receivable_id:uuid,operation:z.enum(['BASELINE','INSERT','UPDATE','DELETE']),captured_at:timestamp,
 transaction_id:positiveInteger,actor_id:uuid.nullable(),actor_name:z.string().nullable(),actor_kind:z.enum(['authenticated','system']),
 before:receivableHistorySnapshotSchema.nullable(),after:receivableHistorySnapshotSchema.nullable(),changed_fields:z.array(z.enum(fields)),
});
export const receivableHistoryRequestSchema=z.object({
 tenantId:uuid,receivableId:uuid.nullable(),page:z.number().int().min(1).max(2147483647),expectedRevision:z.string().regex(/^[0-9a-f]{32}$/).nullable(),
}).refine(value=>value.page===1||value.expectedRevision!==null,'Atualize o histórico antes de trocar de página.');
export type ReceivableHistoryRequest=z.infer<typeof receivableHistoryRequestSchema>;
export const receivableHistorySchema=z.object({
 version:z.literal(1),tenant_id:uuid,receivable_id:uuid.nullable(),basis:z.literal('captured_versions'),captured_at:timestamp,
 revision:z.string().regex(/^[0-9a-f]{32}$/),coverage:z.object({starts_at:timestamp,baseline_kind:z.enum(['existing_tenant','new_tenant']),capture_basis:z.literal('transaction_capture_not_commit')}).nullable(),
 page:z.number().int().positive().max(2147483647),page_size:z.literal(50),total:z.number().int().nonnegative().safe(),rows:z.array(eventSchema).max(50),limitations:z.array(z.string()),
}).superRefine((value,ctx)=>{
 const fail=(message:string)=>ctx.addIssue({code:'custom',message});
 const offset=(value.page-1)*value.page_size;
 if(value.rows.length!==Math.min(50,Math.max(0,value.total-offset)))fail('Página incompleta ou contagem de eventos incompatível.');
 if(!value.coverage&&value.total!==0)fail('Eventos sem informação de início da captura.');
 if(new Set(value.rows.map(row=>row.event_order)).size!==value.rows.length)fail('Eventos repetidos no histórico.');
 for(let index=0;index<value.rows.length;index++){
  const row=value.rows[index];
  if(value.receivable_id&&row.receivable_id!==value.receivable_id)fail('Evento pertence a outro título.');
  if(positiveInteger.safeParse(row.event_order).success&&index>0&&positiveInteger.safeParse(value.rows[index-1].event_order).success&&BigInt(value.rows[index-1].event_order)<=BigInt(row.event_order))fail('Ordenação de eventos inconsistente.');
  if((row.actor_kind==='system')!==(row.actor_id===null)||(row.actor_kind==='system'&&row.actor_name!==null))fail('Autoria incompatível com a captura.');
  const validSides=row.operation==='UPDATE'?row.before!==null&&row.after!==null:row.operation==='DELETE'?row.before!==null&&row.after===null:row.before===null&&row.after!==null;
  if(!validSides)fail('Antes e depois incompatíveis com a operação.');
  if(new Set(row.changed_fields).size!==row.changed_fields.length)fail('Campos alterados repetidos.');
  for(const snapshot of [row.before,row.after])if(snapshot?.payer&&(snapshot.payer.tenant_id!==value.tenant_id||snapshot.payer.id!==snapshot.client_id))fail('Pagador preservado fora do título ou da empresa.');
 }
});
export type ReceivableHistory=z.infer<typeof receivableHistorySchema>;
export type ReceivableHistorySnapshot=z.infer<typeof receivableHistorySnapshotSchema>;
