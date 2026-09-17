import {z} from 'zod';

const uuid=z.string().uuid(),date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/),cents=z.string().regex(/^\d+$/),revision=z.string().regex(/^[a-f0-9]{32}$/);
const nullableCents=cents.nullable();

export const driverAdvanceReturnHistorySchema=z.object({
 return_id:uuid,incoming_movement_id:uuid,amount_cents:cents,actor_id:uuid,actor_name:z.string(),reason:z.string(),created_at:z.string(),occurred_on:date,bank_account_id:uuid,
});
export const driverAdvancePositionSchema=z.object({
 version:z.literal(1),tenant_id:uuid,actor_id:uuid,movement_id:uuid,driver_id:uuid,bank_account_id:uuid,occurred_on:date,amount_cents:cents,
 allocated_cents:nullableCents,returned_cents:nullableCents,open_cents:nullableCents,verified:z.boolean(),issue:z.string().nullable(),revision,
 history:z.array(driverAdvanceReturnHistorySchema),account_name:z.string(),driver_name:z.string().nullable(),history_count:z.number().int().nonnegative(),
});
export type DriverAdvancePosition=z.infer<typeof driverAdvancePositionSchema>;
export const driverAdvancePositionsSchema=z.object({
 version:z.literal(1),tenant_id:uuid,actor_id:uuid,page:z.number().int().positive(),page_size:z.literal(30),total:z.number().int().nonnegative(),revision,rows:z.array(driverAdvancePositionSchema),
});
export const driverAdvanceReturnOptionSchema=z.object({
 id:uuid,bank_account_id:uuid,bank_account_name:z.string(),occurred_on:date,beneficiary_name:z.string().nullable(),description:z.string(),amount_cents:cents,used_cents:cents,available_cents:cents,
});
export const driverAdvanceReturnOptionsSchema=z.object({
 version:z.literal(1),tenant_id:uuid,actor_id:uuid,advance_movement_id:uuid,search:z.string(),page:z.number().int().positive(),page_size:z.literal(30),total:z.number().int().nonnegative(),revision,rows:z.array(driverAdvanceReturnOptionSchema),
});
export const driverAdvanceReturnEffectsSchema=z.object({open_before_cents:cents,open_after_cents:cents.nullable(),cash_created:z.literal(false),expense_created:z.literal(false),original_movement_changed:z.literal(false)});
export const driverAdvanceReturnPreviewSchema=z.object({
 version:z.literal(1),tenant_id:uuid,actor_id:uuid,advance_movement_id:uuid,incoming_movement_id:uuid,amount_cents:cents,position:driverAdvancePositionSchema.omit({account_name:true,driver_name:true,history_count:true}),
 incoming:z.object({movement_id:uuid,bank_account_id:uuid,occurred_on:date,amount_cents:cents,used_cents:cents,available_cents:cents,counterparty_name:z.string().nullable()}),effects:driverAdvanceReturnEffectsSchema,
 eligible:z.boolean(),can_execute:z.boolean(),blockers:z.array(z.string()),revision,
}).superRefine((value,ctx)=>{
 if(value.position.tenant_id!==value.tenant_id||value.position.movement_id!==value.advance_movement_id||value.incoming.movement_id!==value.incoming_movement_id||value.can_execute&&(!value.eligible||value.blockers.length>0||!value.position.verified))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Conferência da devolução de adiantamento inconsistente.'});
});
export type DriverAdvanceReturnPreview=z.infer<typeof driverAdvanceReturnPreviewSchema>;
export const driverAdvanceReturnCommandSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,advance_movement_id:uuid,incoming_movement_id:uuid,amount_cents:z.string().regex(/^[1-9]\d{0,13}$/),expected_revision:revision,reason:z.string().trim().min(10).max(2000)}).strict();
export type DriverAdvanceReturnCommand=z.infer<typeof driverAdvanceReturnCommandSchema>;
export const driverAdvanceReturnResultSchema=z.object({version:z.literal(1),confirmed:z.literal(true),tenant_id:uuid,actor_id:uuid,request_id:uuid,return_id:uuid,advance_movement_id:uuid,incoming_movement_id:uuid,amount_cents:cents,cash_created:z.literal(false),expense_created:z.literal(false),open_cents:cents});
export type DriverAdvanceReturnResult=z.infer<typeof driverAdvanceReturnResultSchema>;
export function parseDriverAdvanceReturnResult(data:unknown,command:DriverAdvanceReturnCommand,actor:string,expectedOpen:string){const value=driverAdvanceReturnResultSchema.parse(data);if(value.tenant_id!==command.tenant_id||value.actor_id!==actor||value.request_id!==command.request_id||value.advance_movement_id!==command.advance_movement_id||value.incoming_movement_id!==command.incoming_movement_id||value.amount_cents!==command.amount_cents||value.open_cents!==expectedOpen)throw Error('Resposta incompatível com a devolução preservada.');return value;}
export function reaisToCents(value:string){const normalized=value.trim().replace(/\./g,'').replace(',','.');if(!/^\d+(\.\d{1,2})?$/.test(normalized))return null;const [whole,fraction='']=normalized.split('.');const result=`${whole}${fraction.padEnd(2,'0')}`.replace(/^0+(?=\d)/,'');return /^[1-9]\d{0,13}$/.test(result)?result:null;}
