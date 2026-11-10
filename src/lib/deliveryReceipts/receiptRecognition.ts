import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
const readingSchema=z.object({receipt_id:z.string().guid(),status:z.enum(['not_requested','queued','processing','completed','failed','unavailable']),
 text:z.string().nullable(),date_text:z.string().nullable(),delivery_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
 date_confidence:z.number().min(0).max(1).nullable(),signature_presence:z.enum(['present','absent','uncertain']).nullable(),
 signature_confidence:z.number().min(0).max(1).nullable(),needs_review:z.boolean(),error_code:z.string().nullable(),updated_at:z.string().nullable()}).strict();
const envelope=z.object({version:z.literal(1),tenant_id:z.string().guid(),actor_id:z.string().guid(),rows:z.array(readingSchema)}).strict();
export type ReceiptRecognitionReading=z.infer<typeof readingSchema>;
export async function readReceiptRecognitions(tenant:string,actor:string,ids:string[],signal:AbortSignal):Promise<ReceiptRecognitionReading[]>{
 const rows:ReceiptRecognitionReading[]=[];const selected=[...new Set(ids)];
 for(let n=0;n<selected.length;n+=100){signal.throwIfAborted();const batch=selected.slice(n,n+100);
  const {data,error}=await supabase.rpc('get_delivery_receipt_ocr_readings_v1' as never,{_tenant_id:tenant,_receipt_ids:batch} as never).abortSignal(signal);
  if(error)throw error;const parsed=envelope.parse(data);
  if(parsed.tenant_id!==tenant||parsed.actor_id!==actor||parsed.rows.some(r=>!batch.includes(r.receipt_id))
   ||new Set(parsed.rows.map(r=>r.receipt_id)).size!==parsed.rows.length)throw new Error('Leitura do canhoto incompatível com a sessão atual.');
  rows.push(...parsed.rows);
 }return rows;
}
