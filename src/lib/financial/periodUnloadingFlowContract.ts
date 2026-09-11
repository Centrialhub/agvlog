import {z} from 'zod';
const uuid=z.string().uuid(),day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;},'Data inválida.'),cents=z.string().regex(/^\d+$/),revision=z.string().regex(/^[a-f0-9]{32}$/);
export const periodUnloadingFlowRequestSchema=z.object({tenantId:uuid,from:day,to:day,accountIds:z.array(uuid),supplierId:uuid.nullable(),page:z.number().int().min(1).max(2147483647),expectedRevision:revision.nullable()})
 .refine(v=>v.from<=v.to&&new Set(v.accountIds).size===v.accountIds.length&&(v.page===1||v.expectedRevision!==null),'Confira período, contas e revisão da página.');
const total=z.object({count:z.number().int().nonnegative().safe(),valid:z.boolean(),amount_cents:cents.nullable()}).superRefine((v,c)=>{if(v.valid!==(v.amount_cents!==null))c.addIssue({code:'custom',message:'Valor incompatível com a validade.'});});
const signedCents=z.string().regex(/^-?\d+$/);
const signedTotal=z.object({count:z.number().int().nonnegative().safe(),valid:z.boolean(),amount_cents:signedCents.nullable()}).superRefine((v,c)=>{if(v.valid!==(v.amount_cents!==null))c.addIssue({code:'custom',message:'Ajuste incompatível com a validade.'});});
const sidecar=z.object({kind:z.enum(['allocation_correction','customer_credit','legacy_association','association_reversal']),id:uuid,recorded_at:z.string(),actor_id:uuid.nullable()});
export const periodUnloadingFlowRowSchema=z.object({
 event_id:uuid,kind:z.enum(['charge','receipt','refund','adjustment']),charge_id:uuid,receivable_id:uuid,supplier_id:uuid,supplier_name:z.string().nullable(),delivery_stop_id:uuid,
 economic_on:day.nullable(),recorded_at:z.string(),amount_cents:signedCents.nullable(),valid:z.boolean(),issues:z.array(z.string()),
 amendment_id:uuid.nullable().optional(),adjustment_leg:z.enum(['release','recognize']).nullable().optional(),amendment_actor_id:uuid.nullable().optional(),amendment_actor_name:z.string().nullable().optional(),amendment_reason:z.string().nullable().optional(),
 original_due_date:day.nullable(),original_command_id:uuid.nullable(),receipt_path:z.string().nullable(),document_ids:z.array(uuid),
 payment_id:uuid.nullable(),reversal_id:uuid.nullable(),command_id:uuid.nullable(),movement_id:uuid.nullable(),bank_account_id:uuid.nullable(),
 money_covered:z.boolean(),closure_ids:z.array(uuid),sidecars:z.array(sidecar),
}).superRefine((v,c)=>{const fail=(message:string)=>c.addIssue({code:'custom',message});if(v.valid&&(v.amount_cents===null||v.economic_on===null||v.issues.length))fail('Evento válido sem prova suficiente.');if(v.money_covered&&(v.movement_id===null||!v.closure_ids.length))fail('Cobertura sem movimento e fechamento.');if(v.kind==='charge'&&(v.event_id!==v.charge_id||v.payment_id!==null||v.reversal_id!==null||v.movement_id!==null||v.money_covered))fail('Cobrança não é movimento de dinheiro.');if(v.kind==='receipt'&&(v.event_id!==v.payment_id||v.reversal_id!==null))fail('Identidade do recebimento divergente.');if(v.kind==='refund'&&(v.event_id!==v.reversal_id||v.payment_id===null))fail('Identidade da devolução divergente.');});
const groups=z.object({supplier_id:uuid,supplier_name:z.string().nullable(),origin_totals:total,receipt_totals:total,refund_totals:total,adjustment_totals:signedTotal.optional(),net_origin_totals:signedTotal.optional()});
export const periodUnloadingFlowSchema=z.object({version:z.union([z.literal(1),z.literal(2)]),tenant_id:uuid,period:z.object({from:day,to:day}),currency:z.literal('BRL'),timezone:z.literal('America/Sao_Paulo'),
 basis:z.literal('economic_event_dates'),evidence_basis:z.literal('currently_available_immutable_records'),not_a_position:z.literal(true),captured_at:z.string(),revision,money_package_revision:revision,
 supplier_id:uuid.nullable(),supplier_options:z.array(z.object({id:uuid,name:z.string().nullable()})),account_scope:z.object({selected_ids:z.array(uuid),excluded_ids:z.array(uuid),complete:z.boolean()}),
 page:z.number().int().positive(),page_size:z.literal(50),total:z.number().int().nonnegative().safe(),unknown_date_count:z.number().int().nonnegative().safe(),
 origin_totals:total,receipt_totals:total,refund_totals:total,adjustment_totals:signedTotal.optional(),net_origin_totals:signedTotal.optional(),supplier_groups:z.array(groups),rows:z.array(periodUnloadingFlowRowSchema).max(50),
 money_links:z.array(z.object({movement_id:uuid,bank_account_id:uuid,amount_cents:cents,allocated_event_cents:cents.nullable(),money_covered:z.boolean(),closure_ids:z.array(uuid),event_ids:z.array(uuid),issues:z.array(z.string())})),
 issues:z.array(z.string()),limitations:z.array(z.string()),
}).superRefine((v,c)=>{
 const fail=(message:string)=>c.addIssue({code:'custom',message});const unique=(ids:string[])=>new Set(ids).size===ids.length;
 const exact=(value:string|null)=>typeof value==='string'&&/^-?\d+$/.test(value)?BigInt(value):null;
 if(v.rows.length!==Math.min(50,Math.max(0,v.total-(v.page-1)*50)))fail('Página incompatível com a contagem.');if(!unique(v.rows.map(r=>r.kind+':'+r.event_id+':'+(r.adjustment_leg??''))))fail('Evento duplicado.');if(!unique(v.money_links.map(r=>r.movement_id)))fail('Dinheiro duplicado na ponte.');
 if(!unique(v.supplier_options.map(x=>x.id))||!unique(v.supplier_groups.map(x=>x.supplier_id))||!unique(v.account_scope.selected_ids)||!unique(v.account_scope.excluded_ids)||v.account_scope.selected_ids.some(id=>v.account_scope.excluded_ids.includes(id)))fail('Escopo duplicado ou sobreposto.');
 if(v.unknown_date_count>v.total||v.origin_totals.count+v.receipt_totals.count+v.refund_totals.count+(v.adjustment_totals?.count??0)!==v.total)fail('Contagens de eventos divergentes.');
 for(const key of ['origin_totals','receipt_totals','refund_totals'] as const){const total=v[key],groups=v.supplier_groups.map(g=>g[key]);if(groups.reduce((s,g)=>s+g.count,0)!==total.count||groups.every(g=>g.valid)!==total.valid)fail('Grupo incompatível com o total.');if(total.valid){const sum=exact(total.amount_cents),parts=groups.map(g=>exact(g.amount_cents));if(sum===null||parts.some(p=>p===null)||parts.reduce<bigint>((s,p)=>s+(p??0n),0n)!==sum)fail('Valor de grupo incompatível com o total.');}}
 for(const row of v.rows)if(v.supplier_id&&row.supplier_id!==v.supplier_id)fail('Fornecedor fora do filtro.');
 const amendmentFields=['amendment_id','adjustment_leg','amendment_actor_id','amendment_actor_name','amendment_reason'] as const;
 if(v.version===1&&(v.adjustment_totals!==undefined||v.net_origin_totals!==undefined||v.rows.some(r=>r.kind==='adjustment')||v.supplier_groups.some(g=>g.adjustment_totals!==undefined||g.net_origin_totals!==undefined)))fail('Ajustes exigem versão 2 do demonstrativo.');
 for(const row of v.rows){
  if(v.version===2&&amendmentFields.some(key=>row[key]===undefined))fail('Prova da versão incompleta.');
  if(row.kind==='adjustment'){
   if(!row.amendment_id||row.event_id!==row.amendment_id||!row.adjustment_leg||!row.amendment_actor_id||!row.amendment_reason?.trim())fail('Ajuste sem identidade e autoria.');
   if(row.payment_id!==null||row.reversal_id!==null||row.movement_id!==null||row.bank_account_id!==null||row.money_covered||row.closure_ids.length)fail('Ajuste de cobrança não é dinheiro.');
   const amount=exact(row.amount_cents);
   if(amount!==null&&((row.adjustment_leg==='release'&&amount>=0n)||(row.adjustment_leg==='recognize'&&amount<=0n)))fail('Sinal do ajuste incompatível com sua finalidade.');
  }else{
   const amount=exact(row.amount_cents);if(amount!==null&&amount<0n)fail('Evento original não admite valor negativo.');
   if(amendmentFields.some(key=>row[key]!=null))fail('Evento original não pode assumir identidade de ajuste.');
  }
 }
 if(v.version===2){
  for(const group of [v,...v.supplier_groups]){
   const adjustment=group.adjustment_totals,net=group.net_origin_totals,origin=group.origin_totals;
   if(!adjustment||!net){fail('Totais dos ajustes ausentes.');continue;}
   if(net.count!==origin.count+adjustment.count||net.valid!==(origin.valid&&adjustment.valid))fail('Composição líquida da cobrança divergente.');
   if(net.valid){const n=exact(net.amount_cents),o=exact(origin.amount_cents),a=exact(adjustment.amount_cents);if(n===null||o===null||a===null||n!==o+a)fail('Valor líquido da cobrança divergente.');}
  }
  for(const key of ['adjustment_totals','net_origin_totals'] as const){
   const sum=v[key],parts=v.supplier_groups.map(g=>g[key]);
   if(!sum||parts.some(p=>!p))continue;
   if(parts.reduce((s,p)=>s+p!.count,0)!==sum.count||parts.every(p=>p!.valid)!==sum.valid)fail('Agrupamento de ajustes divergente.');
   if(sum.valid){const amounts=parts.map(p=>exact(p!.amount_cents)),value=exact(sum.amount_cents);if(value===null||amounts.some(a=>a===null)||amounts.reduce<bigint>((s,a)=>s+(a??0n),0n)!==value)fail('Soma dos ajustes por fornecedor divergente.');}
  }
 }
 for(const link of v.money_links){if(!v.account_scope.selected_ids.includes(link.bank_account_id))fail('Movimento fora das contas selecionadas.');const allocated=exact(link.allocated_event_cents),amount=exact(link.amount_cents);if(allocated!==null&&amount!==null&&allocated>amount)fail('Alocação excede o movimento.');}
});
export type PeriodUnloadingFlow=z.infer<typeof periodUnloadingFlowSchema>;
export type PeriodUnloadingFlowRequest=z.infer<typeof periodUnloadingFlowRequestSchema>;
