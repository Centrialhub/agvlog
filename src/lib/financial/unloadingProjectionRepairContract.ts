import {z} from 'zod';
const uuid=z.string().uuid(),revision=z.string().regex(/^[a-f0-9]{32}$/);
const cents=z.string().regex(/^[1-9]\d{0,13}$/),observedCents=z.string().regex(/^-?\d+$/).nullable();
const original=z.object({supplier_id:uuid,supplier_name:z.string().nullable(),amount_cents:cents,delivery_stop_id:uuid}).strict();
const projection=z.object({client_id:uuid.nullable(),amount_cents:observedCents}).strict();
const target=z.object({client_id:uuid,amount_cents:cents}).strict();
export const unloadingProjectionRepairContextSchema=z.object({
 version:z.literal(1),tenant_id:uuid,actor_id:uuid,charge_id:uuid,receivable_id:uuid,revision,
 origin_verified:z.boolean(),original,current:projection.extend({receivable_id:uuid,status:z.string().nullable()}).strict(),target,
 dependencies:z.array(z.object({source_table:z.string(),source_id:uuid,blocking:z.boolean(),reason:z.string()}).strict()),
 blockers:z.array(z.object({code:z.string(),source_table:z.string(),source_ids:z.array(uuid)}).strict()),
 eligible:z.boolean(),can_repair:z.boolean(),can_execute:z.boolean(),
 history:z.array(z.object({id:uuid,request_id:uuid,actor_id:uuid,actor_name:z.string(),reason:z.string(),created_at:z.string(),before:projection,after:target}).strict()),
 effects:z.object({cash_changed:z.literal(false),charge_changed:z.literal(false),cost_changed:z.literal(false)}).strict(),
}).strict().superRefine((v,c)=>{
 const fail=(message:string)=>c.addIssue({code:'custom',message});
 if(v.current.receivable_id!==v.receivable_id||v.target.client_id!==v.original.supplier_id||v.target.amount_cents!==v.original.amount_cents)fail('Destino diferente da origem preservada.');
 if(v.eligible!==!v.blockers.length||(v.eligible&&(!v.origin_verified||v.dependencies.some(d=>d.blocking))))fail('Elegibilidade incompatível com as evidências.');
 if(v.can_execute&&(!v.eligible||!v.can_repair))fail('Confirmação sem elegibilidade e permissão.');
 if(new Set(v.history.map(row=>row.id)).size!==v.history.length)fail('Histórico de reparação duplicado.');
});
export type UnloadingProjectionRepairContext=z.infer<typeof unloadingProjectionRepairContextSchema>;
