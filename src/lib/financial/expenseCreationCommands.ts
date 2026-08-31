import {z} from 'zod';
import {isRecord} from '@/lib/loads/operationDocumentOutcome';
const id=z.string().uuid(),revision=z.string().regex(/^[a-f0-9]{32}$/),text=z.string().max(2000).nullable().optional();
export const receiptSchema=z.object({sha256:z.string().regex(/^[a-f0-9]{64}$/),mime:z.enum(['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']),size:z.number().int().positive().max(10485760)}).strict();
export const expenseFieldsSchema=z.object({
 category:z.enum(['fuel','food','toll','maintenance','parking','other']),amount_cents:z.number().int().positive().max(99999999999999),expense_at:z.string().datetime({offset:true}),
 payment_source:z.enum(['driver','advance','company_card','company_account','other']),reimbursable:z.boolean(),no_receipt:z.boolean(),no_receipt_reason:text,
 notes:text,supplier_name:text,document_number:text,city:text,state:text,odometer:z.number().min(0).max(999999999).nullable().optional(),cost_center:text,
}).strict();
export const expenseCreationSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,request_id:id,source_type:z.enum(['trip','settlement']),source_id:id,expected_revision:revision,fields:expenseFieldsSchema,receipt:receiptSchema.nullable()}).strict().superRefine((p,ctx)=>{
 const f=p.fields;const invalid=(message:string)=>ctx.addIssue({code:z.ZodIssueCode.custom,message});
 if(f.no_receipt?(p.receipt!==null||!f.no_receipt_reason||f.no_receipt_reason.trim().length<5):(!p.receipt||!!f.no_receipt_reason?.trim()))invalid('Anexe o comprovante ou informe o motivo da ausência (mínimo 5 caracteres).');
 if((['company_card','company_account'].includes(f.payment_source)&&f.reimbursable)||(f.payment_source==='advance'&&!f.reimbursable))invalid('Origem do pagamento e reembolso incompatíveis.');
 if(p.source_type==='settlement'&&!f.cost_center?.trim())invalid('Informe o centro de custo.');
});
export type ExpenseCreationCommand=z.infer<typeof expenseCreationSchema>;
export type ExpenseCreationInput=Omit<ExpenseCreationCommand,'version'|'tenant_id'|'actor_id'|'request_id'>;
export type ExpenseFields=z.infer<typeof expenseFieldsSchema>;
const contextSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,source_type:z.enum(['trip','settlement']),source_id:id,driver_id:id,driver_name:z.string(),
 trip_id:id.nullable(),settlement_id:id.nullable(),manual_settlement_id:id.nullable(),can_create:z.boolean(),source_state:z.string(),revision}).strict();
export type ExpenseCreationContext=z.infer<typeof contextSchema>;
export function parseCreationContext(value:unknown,tenant:string,actor:string,type:string,source:string){
 const p=contextSchema.parse(value);if(p.tenant_id!==tenant||p.actor_id!==actor||p.source_type!==type||p.source_id!==source)throw new Error('Contexto incompatível com a sessão.');return p;
}
export function receiptPath(payload:Pick<ExpenseCreationCommand,'tenant_id'|'actor_id'|'request_id'|'receipt'>){
 if(!payload.receipt)return null;const ext:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif','application/pdf':'pdf'};
 return payload.tenant_id+'/expense-receipts/'+payload.actor_id+'/'+payload.request_id+'/receipt.'+ext[payload.receipt.mime];
}
const receiptAck=z.object({version:z.literal(1),tenant_id:id,actor_id:id,request_id:id,source_type:z.enum(['trip','settlement']),source_id:id,path:z.string(),uploaded:z.boolean(),receipt:receiptSchema}).strict();
export function parseReceiptStatus(value:unknown,p:ExpenseCreationCommand){
 const a=receiptAck.parse(value);if(a.tenant_id!==p.tenant_id||a.actor_id!==p.actor_id||a.request_id!==p.request_id||a.source_type!==p.source_type||a.source_id!==p.source_id||a.path!==receiptPath(p)||!p.receipt
  ||a.receipt.sha256!==p.receipt.sha256||a.receipt.mime!==p.receipt.mime||a.receipt.size!==p.receipt.size)throw new Error('Comprovante sem confirmação compatível. Recupere o mesmo pedido.');return a;
}
const resultSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,request_id:id,source_type:z.enum(['trip','settlement']),source_id:id,expense_id:id,command_id:id,driver_id:id,status:z.literal('pending'),confirmed:z.literal(true),receipt_path:z.string().nullable()}).strict();
export type ExpenseCreationResult=z.infer<typeof resultSchema>;
export function parseCreationResult(value:unknown,p:ExpenseCreationCommand){
 const a=resultSchema.parse(value);if(a.tenant_id!==p.tenant_id||a.actor_id!==p.actor_id||a.request_id!==p.request_id||a.source_type!==p.source_type||a.source_id!==p.source_id||a.receipt_path!==receiptPath(p))throw new Error('A confirmação não corresponde à despesa. Recupere o mesmo pedido.');return a;
}
export function creationError(cause:unknown){
 if(cause instanceof z.ZodError)return cause.issues.map(issue=>issue.message).join(' · ');
 const message=cause instanceof Error?cause.message:isRecord(cause)?String(cause.message??''):'';
 if(/expense_creation_mfa_required/.test(message))return 'A política de acesso do servidor está desatualizada. Contate o administrador e preserve este pedido.';
 if(/expense_creation_suspended|expense_creation_release_busy|permission denied for function (create_driver_expense_command|inspect_expense_receipt_upload|recalculate_manual_expense_settlement)/.test(message))return 'Registro de despesas temporariamente suspenso. Preserve o pedido e o comprovante para recuperar após a liberação.';
 if(/context_changed|concurrent_change/.test(message))return 'A viagem ou o acerto mudou ou está em uso. Atualize o contexto antes de registrar.';
 if(/not_authorized|permission denied/.test(message))return 'Sua sessão não tem permissão para registrar esta despesa.';
 if(/source_locked/.test(message))return 'Este acerto ou viagem não aceita novas despesas.';
 if(/reconciliation_required/.test(message))return 'Há despesas legadas com vínculo a conferir. Reconcilie o acerto antes do recálculo; os itens foram preservados.';
 if(/receipt_/.test(message))return 'O comprovante não foi confirmado para este pedido. Recupere com o mesmo arquivo.';
 return message||'Despesa sem confirmação. Recupere o mesmo pedido antes de repetir.';
}
