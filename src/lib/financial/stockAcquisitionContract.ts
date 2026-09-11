import {z} from 'zod';
const uuid=z.string().uuid(),cents=z.string().regex(/^\d+$/),revision=z.string().regex(/^[a-f0-9]{32}$/),reason=z.string().trim().min(10).max(2000),count=z.number().int().nonnegative(),quantity=z.string().regex(/^[0-9]+(\.[0-9]+)?$/).refine(value=>/[1-9]/.test(value));
const base={version:z.literal(1),tenant_id:uuid,request_id:uuid};
export const stockAcquisitionAssociateCommandSchema=z.object({...base,inbound_movement_id:uuid,cost_id:uuid,revision,quantity,document_number:z.string().min(1).max(200),same_purchase_confirmed:z.literal(true),reason}).strict();
export const stockAcquisitionReverseCommandSchema=z.object({...base,link_id:uuid,revision,reason}).strict();
export const stockAcquisitionPendingSchema=z.discriminatedUnion('kind',[z.object({kind:z.literal('associate'),command:stockAcquisitionAssociateCommandSchema}),z.object({kind:z.literal('reverse'),command:stockAcquisitionReverseCommandSchema})]);
export type StockAcquisitionPending=z.infer<typeof stockAcquisitionPendingSchema>;
const result={...base,link_id:uuid,inbound_movement_id:uuid,stock_item_id:uuid,cost_id:uuid,amount_cents:cents,quantity,confirmed:z.literal(true),cash_changed:z.literal(false),obligation_created:z.literal(false),cost_created:z.literal(false)};
export const stockAcquisitionAssociateResultSchema=z.object(result);
export const stockAcquisitionReverseResultSchema=z.object({...result,reversal_id:uuid});
const link=z.object({id:uuid,cost_id:uuid,supplier_id:uuid,quantity,amount_cents:cents,actor_id:uuid,actor_name:z.string(),reason:z.string(),created_at:z.string(),revision,dependencies:z.object({ready:z.boolean(),blocking_count:count,rows:z.array(z.unknown())})});
export const stockAcquisitionContextSchema=z.object({version:z.literal(1),tenant_id:uuid,inbound_movement_id:uuid,page:z.number().int().positive(),page_size:z.literal(30),search:z.string().max(200),total:count,source:z.object({id:uuid,stock_item_id:uuid,item_name:z.string().nullable(),movement_type:z.string(),reason:z.string().nullable(),movement_date:z.string().nullable(),quantity:z.string().nullable(),unit_cost_cents:cents.nullable(),unit_cost_decimal:z.string().nullable(),unit_price_policy:z.literal("rounded_extended_total_cents_v1"),total_cost_cents:cents.nullable()}),active_link:link.nullable(),history:z.object({total:count,rows:z.array(link.extend({reversal:z.object({id:uuid,actor_id:uuid,actor_name:z.string(),reason:z.string(),created_at:z.string()}).nullable()})).max(30)}),candidates:z.array(z.object({cost_id:uuid,batch_id:uuid,description:z.string(),context:z.string(),category:z.string(),amount_cents:cents,occurred_on:z.string().nullable(),supplier_id:uuid.nullable(),supplier_name:z.string().nullable(),document_number:z.string().nullable(),issue:z.string().nullable(),revision})).max(30)}).superRefine((data,ctx)=>{if(data.source.id!==data.inbound_movement_id||new Set(data.candidates.map(row=>row.cost_id)).size!==data.candidates.length||data.candidates.length>data.total||data.history.rows.length>data.history.total)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Contexto fora da entrada de estoque.'});});
export const stockAcquisitionIssueLabels:Record<string,string>={finance_access_denied:'Seu acesso financeiro não foi confirmado.',finance_request_conflict:'Este pedido identifica outra decisão. Confira o histórico.'};
export const stockAcquisitionInventorySchema=z.object({version:z.literal(1),tenant_id:uuid,page:z.number().int().positive(),page_size:z.literal(30),search:z.string().max(200),total:count,associated_count:count,unassociated_count:count,rows:z.array(z.object({id:uuid,stock_item_id:uuid,item_name:z.string().nullable(),reason:z.string(),movement_date:z.string().nullable(),quantity:z.string().nullable(),total_cost_cents:cents.nullable(),active_link_id:uuid.nullable()})).max(30)}).superRefine((data,ctx)=>{if(data.associated_count+data.unassociated_count!==data.total||data.rows.length>data.total||new Set(data.rows.map(row=>row.id)).size!==data.rows.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Contagem do inventário incompatível.'});});
Object.assign(stockAcquisitionIssueLabels,{
 finance_stock_acquisition_source_not_found:'A entrada de estoque não foi encontrada nesta empresa.',
 finance_stock_acquisition_not_purchase:'A origem precisa estar explicitamente registrada como entrada de compra.',
 finance_stock_acquisition_catalog_invalid:'O item de estoque não foi encontrado nesta empresa.',
 finance_stock_acquisition_invalid_value:'Quantidade, data e valores da entrada precisam ser válidos e coerentes.',
 finance_stock_acquisition_cost_not_found:'O custo escolhido não foi encontrado.',
 finance_stock_acquisition_target_context:'O custo precisa pertencer ao contexto elegível desta aquisição.',
 finance_stock_acquisition_supplier_required:'O custo precisa de fornecedor cadastrado válido.',
 finance_stock_acquisition_document_required:'O custo precisa de documento que identifique a compra.',
 finance_stock_acquisition_source_mismatch:'O valor declarado na entrada não corresponde ao custo escolhido.',
 finance_stock_acquisition_obligation_invalid:'O título do custo está cancelado ou diverge do fornecedor ou valor.',
 finance_stock_acquisition_obligation_conflict:'Há uma obrigação conflitante; confira os vínculos existentes.',
 finance_stock_acquisition_part_conflict:'Uma peça de manutenção já aponta para esta entrada. Revise a origem antes de associar.',
 finance_stock_acquisition_declaration_mismatch:'Quantidade ou documento divergem da origem conferida.',
 finance_stock_acquisition_changed:'A entrada, o custo ou seus vínculos mudaram. Atualize e revise novamente.',
 finance_stock_acquisition_concurrent_change:'Outra operação alterou este contexto. Atualize a consulta.',
 finance_stock_acquisition_link_not_found:'A associação não foi encontrada nesta empresa.',
 finance_stock_acquisition_already_reversed:'A associação já foi desfeita. Confira o histórico.',
 finance_stock_acquisition_has_dependents:'Desfaça as atribuições dependentes antes de desfazer esta associação.',
 finance_stock_acquisition_source_protected:'Desfaça a associação e suas dependências antes de corrigir dados financeiros da entrada.',
 finance_stock_acquisition_inactive:'Esta aquisição não está ativa para receber atribuições.',
 finance_stock_acquisition_capacity_exceeded:'A quantidade ou o valor atribuído excede a aquisição disponível.',
 finance_maintenance_cost_already_associated:'A origem ou o custo já possui uma associação ativa. Confira o histórico.'
});
