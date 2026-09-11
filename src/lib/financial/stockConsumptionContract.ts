import {z} from 'zod';
const uuid=z.string().uuid(),reason=z.string().trim().min(10).max(2000),revision=z.string().regex(/^[a-f0-9]{32}$/),quantity=z.string().regex(/^[0-9]+(\.[0-9]+)?$/).refine(value=>/[1-9]/.test(value)),cents=z.string().regex(/^\d+$/);
const base={version:z.literal(1),tenant_id:uuid,request_id:uuid};
export const stockConsumptionSelectionSchema=z.array(z.object({acquisition_link_id:uuid,quantity}).strict()).min(1).max(100).superRefine((rows,ctx)=>{if(new Set(rows.map(row=>row.acquisition_link_id)).size!==rows.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Cada aquisição deve aparecer uma única vez.'});});
export const stockConsumptionAttributeCommandSchema=z.object({...base,maintenance_part_id:uuid,consumption_movement_id:uuid,lines:stockConsumptionSelectionSchema,revision,reason,same_stock_origin_confirmed:z.literal(true),discrepancy_confirmed:z.boolean()}).strict();
export const stockConsumptionReverseCommandSchema=z.object({...base,attribution_id:uuid,revision,reason}).strict();
export const stockConsumptionPendingSchema=z.discriminatedUnion('kind',[z.object({kind:z.literal('attribute'),command:stockConsumptionAttributeCommandSchema}),z.object({kind:z.literal('reverse'),command:stockConsumptionReverseCommandSchema})]);
export type StockConsumptionPending=z.infer<typeof stockConsumptionPendingSchema>;
export type StockConsumptionSelection=z.infer<typeof stockConsumptionSelectionSchema>;
const result={...base,attribution_id:uuid,maintenance_part_id:uuid,consumption_movement_id:uuid,order_id:uuid,quantity,attributed_cents:cents,policy:z.literal('remaining_balance_floor_v1'),cash_changed:z.literal(false),cost_created:z.literal(false),obligation_created:z.literal(false),confirmed:z.literal(true)};
export const stockConsumptionAttributeResultSchema=z.object(result);
export const stockConsumptionReverseResultSchema=z.object({...result,reversal_id:uuid});
export const stockConsumptionIssueLabels:Record<string,string>={finance_access_denied:'Seu acesso financeiro não foi confirmado.',finance_request_conflict:'Este pedido identifica outra decisão. Confira o histórico.'};
const count=z.number().int().nonnegative(),signedDecimal=z.string().regex(/^-?[0-9]+(\.[0-9]+)?$/),signedCents=z.string().regex(/^-?\d+$/),policy=z.literal('remaining_balance_floor_v1');
const attribution=z.object({id:uuid,policy,revision,quantity,attributed_cents:cents,actor_id:uuid,actor_name:z.string(),reason:z.string(),created_at:z.string(),lines:z.array(z.object({id:uuid,acquisition_link_id:uuid,quantity,amount_cents:cents,balance_snapshot:z.unknown()}))});
export const stockConsumptionContextSchema=z.object({version:z.literal(1),tenant_id:uuid,part_id:uuid,movement_id:uuid,page:z.number().int().positive(),page_size:z.literal(30),search:z.string().max(200),total:count,source:z.object({part_id:uuid,movement_id:uuid,order_id:uuid,order_number:z.string().nullable(),order_status:z.string().nullable(),stock_item_id:uuid,item_name:z.string().nullable(),unit:z.string().nullable(),part_quantity:z.string().nullable(),movement_quantity:z.string().nullable(),movement_date:z.string().nullable(),declared_part_cents:cents.nullable(),declared_movement_cents:cents.nullable()}),candidates:z.array(z.object({acquisition_link_id:uuid,inbound_movement_id:uuid,cost_id:uuid,supplier_id:uuid,supplier_name:z.string().nullable(),document_number:z.string().nullable(),acquired_on:z.string().nullable(),quantity,amount_cents:cents,available_quantity:signedDecimal,available_cents:signedCents,availability_issue:z.string().nullable()})).max(30),active_attribution:attribution.nullable(),history:z.object({total:count,rows:z.array(attribution.extend({reversal:z.object({id:uuid,actor_id:uuid,actor_name:z.string(),reason:z.string(),created_at:z.string()}).nullable()})).max(30)})}).superRefine((data,ctx)=>{if(data.source.part_id!==data.part_id||data.source.movement_id!==data.movement_id||data.candidates.length>data.total||data.history.rows.length>data.history.total)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Contexto fora do consumo selecionado.'});});
export const stockConsumptionPreviewSchema=z.object({version:z.literal(1),tenant_id:uuid,part_id:uuid,movement_id:uuid,revision,eligible:z.boolean(),issue:z.string().nullable(),policy,quantity,declared_part_cents:cents.nullable(),declared_movement_cents:cents.nullable(),attributed_cents:cents.nullable(),discrepancy:z.boolean(),lines:z.array(z.object({acquisition_link_id:uuid,quantity,amount_cents:cents.nullable(),available_quantity_before:signedDecimal.nullable(),available_cents_before:signedCents.nullable(),available_quantity_after:signedDecimal.nullable(),available_cents_after:signedCents.nullable()})).min(1).max(100),snapshot:z.record(z.unknown())}).superRefine((data,ctx)=>{if(data.eligible!==(data.issue===null)||new Set(data.lines.map(row=>row.acquisition_link_id)).size!==data.lines.length||(data.eligible&&(data.attributed_cents===null||data.lines.some(row=>row.amount_cents===null))))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Conferência de consumo inconsistente.'});});
export type StockConsumptionContext=z.infer<typeof stockConsumptionContextSchema>;
export type StockConsumptionPreview=z.infer<typeof stockConsumptionPreviewSchema>;
export function canonicalStockQuantity(value:string){const [whole,fraction='']=value.split('.');return (whole.replace(/^0+(?=\d)/,'')||'0')+'.'+fraction.replace(/0+$/,'');}

Object.assign(stockConsumptionIssueLabels,{
 finance_stock_consumption_source_not_found:'A peça ou o movimento de consumo não foi encontrado nesta empresa.',
 finance_stock_consumption_source_mismatch:'A peça e o movimento precisam identificar o mesmo item, OS e quantidade de consumo.',
 finance_stock_consumption_invalid_quantity:'A quantidade precisa ser positiva e a data de consumo válida.',
 finance_stock_consumption_context_invalid:'O item precisa estar cadastrado e a OS concluída nesta empresa.',
 finance_stock_consumption_already_attributed:'A peça ou o consumo já possui atribuição ou associação ativa. Confira o histórico.',
 finance_stock_consumption_invalid_lines:'Selecione até 100 aquisições distintas com quantidades decimais positivas.',
 finance_stock_consumption_acquisition_inactive:'Uma aquisição selecionada não está ativa.',
 finance_stock_consumption_acquisition_mismatch:'A aquisição precisa ser do mesmo item e anterior ou igual ao consumo.',
 finance_stock_consumption_capacity_exceeded:'Uma aquisição não possui quantidade ou valor disponível suficiente. Atualize o cálculo.',
 finance_stock_consumption_quantity_mismatch:'A soma das quantidades selecionadas precisa corresponder exatamente ao consumo.',
 finance_stock_consumption_changed:'As origens ou os saldos mudaram. Atualize e calcule novamente.',
 finance_stock_consumption_concurrent_change:'Outra operação alterou o contexto. Atualize a conferência.',
 finance_stock_consumption_discrepancy_confirmation_required:'Confirme expressamente a diferença entre o valor declarado e o calculado.',
 finance_stock_consumption_not_found:'A atribuição não foi encontrada nesta empresa.',
 finance_stock_consumption_already_reversed:'A atribuição já foi desfeita. Confira o histórico.',
 finance_stock_consumption_source_protected:'Desfaça a atribuição antes de corrigir dados financeiros ou a identidade do consumo.'
});
