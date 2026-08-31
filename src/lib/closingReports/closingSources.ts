import {z} from 'zod';
const id=z.string().uuid();const nullableId=id.nullable();const text=z.string().nullable();
const amount=z.number().finite().min(-999999999999).max(999999999999);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
 const parsed=new Date(value+'T00:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
});
const instant=z.string().refine(value=>Number.isFinite(Date.parse(value)));
export const closingSourceFilterSchema=z.object({period_start:date,period_end:date,
 date_basis:z.enum(['invoice_issue','delivery_result']).default('invoice_issue'),client_id:nullableId.default(null),
 vehicle_id:nullableId.default(null),driver_id:nullableId.default(null),only_delivered:z.boolean().default(false),
}).strict().refine(value=>value.period_start<=value.period_end&&
 (Date.parse(value.period_end)-Date.parse(value.period_start))/86400000<=366,'Período inválido ou superior a 366 dias.');
export type ClosingSourceFilters=z.infer<typeof closingSourceFilterSchema>;
const sourceSchema=z.object({key:z.string().min(1).max(120),allocation_id:nullableId,attempt_id:nullableId,historical:z.boolean(),
 document:z.object({id,load_id:nullableId,client_id:nullableId,invoice_number:text,access_key:text,issue_date:date.nullable(),
  origin_city:text,origin_state:text,remitter:text,remitter_cnpj:text,recipient:text,recipient_cnpj:text,recipient_city:text,recipient_state:text,
  value:amount,weight_kg:amount,volume_count:amount,freight_value:amount,freight_cif_value:amount,freight_fob_value:amount,outbound_cte_id:nullableId}).strict(),
 load:z.object({id,load_number:text,arrival_date:date.nullable(),departure_at:instant.nullable(),arrival_at:instant.nullable(),
  vehicle_id:nullableId,vehicle_plate:text,driver_id:nullableId,driver_name:text}).strict().nullable(),
 outcome:z.object({id,status:z.enum(['delivered','partial_delivery','returned','refused','failed','cancelled','not_delivered']),
  occurred_at:instant,recorded_at:instant,source:z.enum(['driver','operation']),event_id:id,trip_id:id,stop_id:id}).strict().nullable(),
 physical:z.object({item_count:z.number().int().nonnegative(),quantity:amount,weight_kg:amount,pallet_count:amount,volume_m3:amount,
  source:z.enum(['load_items','reserved_attempt','none'])}).strict(),financial_review_required:z.boolean(),volume_count_verified:z.boolean(),
}).strict().refine(row=>row.document.load_id===(row.load?.id??null),'Vínculo de carga inconsistente.')
 .refine(row=>row.attempt_id===null||row.financial_review_required,'Reentrega sem revisão financeira.')
 .refine(row=>row.attempt_id===null||(row.document.freight_value===0&&row.document.freight_cif_value===0&&row.document.freight_fob_value===0&&!row.volume_count_verified),
  'Frete ou volumes herdados em uma nova tentativa.');
const candidateSchema=z.object({kind:z.enum(['cte_document','outbound_document']),id,number:text,access_key:text,
 freight_value:amount.nullable(),status:text,sefaz_status:text,environment:text,cancelled_at:instant.nullable(),is_voided:z.boolean().nullable(),
 receivable_id:nullableId,load_ids:z.array(id).nullable(),document_ids:z.array(id).nullable()}).strict();
const responseSchema=z.object({version:z.literal(1),complete:z.literal(true),tenant_id:id,actor_id:id,
 filters:closingSourceFilterSchema,revision:z.string().regex(/^[a-f0-9]{32}$/),documents:z.array(sourceSchema).max(500),
 fiscal_candidates:z.array(candidateSchema).max(500),allocation_documents:z.array(sourceSchema).max(2000)}).strict();
export type ClosingSource=z.infer<typeof sourceSchema>;
export type ClosingFiscalCandidate=z.infer<typeof candidateSchema>;
export type ClosingSources=z.infer<typeof responseSchema>;
export function parseClosingSources(value:unknown,expected:{tenantId:string;actorId:string;filters:ClosingSourceFilters}):ClosingSources{
 const result=responseSchema.safeParse(value);
 if(!result.success)throw new Error('Leitura de fechamento incompleta ou incompatível. Atualize os dados; nenhum relatório foi criado.');
 const row=result.data;const filters=closingSourceFilterSchema.parse(expected.filters);
 if(row.tenant_id!==expected.tenantId||row.actor_id!==expected.actorId||JSON.stringify(row.filters)!==JSON.stringify(filters))
  throw new Error('A resposta pertence a outra sessão, empresa ou seleção de filtros. Gere uma nova prévia.');
 if(new Set(row.documents.map(d=>d.key)).size!==row.documents.length||new Set(row.allocation_documents.map(d=>d.key)).size!==row.allocation_documents.length
  ||new Set(row.fiscal_candidates.map(c=>c.kind+':'+c.id)).size!==row.fiscal_candidates.length)
  throw new Error('Leitura com origens duplicadas. Revise a composição antes do fechamento.');
 return row;
}
export function closingSourceError(error:unknown):string{
 const message=error instanceof Error?error.message:typeof error==='object'&&error!==null&&'message' in error?String(error.message):'';
 if(message.includes('not_authorized'))return 'Sua sessão não tem permissão para consultar este fechamento.';
 if(message.includes('refine_'))return 'A seleção excede o limite de leitura completa. Reduza o período ou use filtros; nenhum total parcial foi apresentado.';
 if(message.includes('invalid_'))return 'Confira o período e os filtros do fechamento.';
 return message||'Não foi possível consultar as tentativas de entrega.';
}
