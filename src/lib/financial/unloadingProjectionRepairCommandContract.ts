import {z} from 'zod';
const id=z.string().uuid();
export const unloadingProjectionRepairCommandSchema=z.object({
 version:z.literal(1),tenant_id:id,request_id:id,charge_id:id,
 revision:z.string().regex(/^[a-f0-9]{32}$/),reason:z.string().refine(v=>v.trim().length>=10&&v.trim().length<=2000,'Informe o motivo da reparação, entre 10 e 2000 caracteres.'),
}).strict();
export const unloadingProjectionRepairResultSchema=z.object({
 version:z.literal(1),tenant_id:id,actor_id:id,request_id:id,charge_id:id,receivable_id:id,repair_id:id,
 confirmed:z.literal(true),cash_changed:z.literal(false),charge_changed:z.literal(false),cost_changed:z.literal(false),
}).strict();
export type UnloadingProjectionRepairCommand=z.infer<typeof unloadingProjectionRepairCommandSchema>;
export type UnloadingProjectionRepairResult=z.infer<typeof unloadingProjectionRepairResultSchema>;
export function parseUnloadingProjectionRepairResult(value:unknown,command:UnloadingProjectionRepairCommand,actorId:string,receivableId:string){
 const result=unloadingProjectionRepairResultSchema.parse(value);
 if(result.tenant_id!==command.tenant_id||result.request_id!==command.request_id||result.charge_id!==command.charge_id||result.actor_id!==actorId||result.receivable_id!==receivableId)throw new Error('A confirmação não corresponde ao pedido de reparação. Recupere o mesmo pedido na sessão original.');
 return result;
}
