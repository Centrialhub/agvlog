import {z} from 'zod';
const count=z.number().int().nonnegative(),uuid=z.string().uuid();
export const fiscalQueueStatuses={pending:'Aguardando processamento',review:'Revisão necessária',applied:'Processado',superseded:'Substituído por estado mais recente'};
export type FiscalQueueStatus=''|keyof typeof fiscalQueueStatuses;
export const fiscalQueueSchema=z.object({version:z.literal(1),tenant_id:uuid,page:z.number().int().positive(),page_size:z.literal(30),
 status_filter:z.enum(['','pending','review','applied','superseded']),total:count,scheduler_active:z.boolean(),
 counts:z.object({pending:count,review:count,applied:count,superseded:count}),rows:z.array(z.object({
  observation_id:uuid,tenant_id:uuid,status:z.enum(['pending','review','applied','superseded']),document_type:z.enum(['cte','nfse']),
  document_number:z.string().nullable(),fiscal_status:z.string(),attempts:count,automatic_failures:count,issue:z.string().nullable(),
  available_at:z.string(),created_at:z.string(),updated_at:z.string(),receivable_id:uuid.nullable(),
 }))});
export function fiscalQueueIssue(issue:string|null){
 if(!issue)return null;
 if(issue==='automatic_projection_retry')return 'Uma falha interrompeu esta tentativa. Uma nova tentativa foi programada.';
 if(issue==='automatic_projection_failed')return 'As tentativas automáticas falharam. Solicite revisão do processamento antes de retomar.';
 if(issue==='newer_fiscal_state')return 'Há um estado fiscal mais recente; este registro não altera a cobrança.';
 const reasons:Record<string,string>={
  authorization_integration_receipt_collision:'O protocolo coincide com o lote de envio da integração. Confira o protocolo de autorização no XML fiscal.',
  authorization_evidence_missing:'Falta número, chave ou protocolo de autorização válido.',
  invalid_receivable_amount:'O valor a receber está ausente ou inválido; confira o valor fiscal e a precisão em centavos.',
  retention_data_missing:'Faltam dados das retenções da NFS-e.',
  nfse_net_amount_conflict:'O valor líquido da NFS-e não confere com o bruto e as retenções.',
  authorization_not_active:'O documento não possui autorização ativa para cobrança.'
 };
 const parts=issue.split(',').map(code=>code.trim());
 if(parts.some(code=>reasons[code]))return parts.map(code=>reasons[code]||'Há outra pendência nos dados ou vínculos do documento fiscal.').join(' ');
 if(issue.includes('billing_group'))return 'Confira a distribuição dos valores na fatura ou no fechamento agrupado.';
 if(issue.includes('receipt')||issue.includes('credit'))return 'Confira os recebimentos e as evidências antes de regularizar o crédito.';
 if(issue.includes('payer'))return 'Confira a identificação e o cadastro do pagador.';
 if(issue.includes('existing_receivable')||issue.includes('origin'))return 'Confira o vínculo com a cobrança existente para evitar duplicidade.';
 return 'Confira os dados, valores e vínculos do documento fiscal. A projeção exige revisão.';
}
