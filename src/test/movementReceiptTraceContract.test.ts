import {it,expect} from 'vitest';
import {movementReceiptTraceSchema,movementReceiptTraceRowSchema} from '@/lib/financial/movementReceiptTraceContract';
const id=crypto.randomUUID(),actor=crypto.randomUUID(),payment=crypto.randomUUID(),receivable=crypto.randomUUID();
const common={link_id:id,payment_id:payment,receivable_id:receivable,reference:'Título QA',created_at:'2026-09-10T00:00:00Z',amount_cents:50000,credit:null,reversal_id:null};
const canonical={...common,origin:'canonical',command_id:id,action:'receive',correction:null,association:null,association_reversal:null};
const legacy={...common,origin:'legacy_adoption',command_id:null,action:'receive',correction:null,association:{actor_id:actor,actor_name:'Ana',reason:'Recebimento conferido',created_at:common.created_at,existing_receipt_confirmed:true},association_reversal:null};
it('validates both origins without manufacturing a command for an old receipt',()=>{
 expect(movementReceiptTraceRowSchema.parse(canonical).command_id).toBe(id);expect(movementReceiptTraceRowSchema.parse(legacy).command_id).toBeNull();expect(movementReceiptTraceSchema.parse({version:1,tenant_id:crypto.randomUUID(),movement_id:crypto.randomUUID(),page:1,page_size:20,total:2,rows:[canonical,legacy]}).rows).toHaveLength(2);
});
it('rejects origin confusion, undocumented declaration and canonical link identity mismatch',()=>{
 for(const row of [{...canonical,command_id:null},{...canonical,link_id:crypto.randomUUID()},{...canonical,association:legacy.association},{...canonical,association_reversal:{id,actor_id:actor,actor_name:'Ana',reason:'Correção',created_at:common.created_at}},{...legacy,command_id:id},{...legacy,association:null},{...legacy,action:'reverse'},{...legacy,correction:{id,actor_id:actor,actor_name:'Ana',reason:'Correção',created_at:common.created_at}},{...legacy,association:{...legacy.association,existing_receipt_confirmed:false}}])expect(movementReceiptTraceRowSchema.safeParse(row).success).toBe(false);
});
