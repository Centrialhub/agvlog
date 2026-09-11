import {z} from 'zod';
export const automaticReconciliationSchema=z.object({version:z.literal(1),tenant_id:z.string().uuid(),import_id:z.string().uuid(),
 status:z.enum(['pending','complete','review','superseded','unsupported_format','waiting_source','not_queued']),scheduler_active:z.boolean(),
 matched_count:z.number().int().nonnegative(),issue:z.string().nullable(),updated_at:z.string().nullable(),verification_id:z.string().uuid().nullable()});
export const automaticReconciliationLabels={pending:'Aguardando processamento',complete:'Varredura concluída',review:'Precisa de revisão',superseded:'Substituída por nova conferência',unsupported_format:'Formato sem conciliação automática',waiting_source:'Aguardando conferência do original',not_queued:'Conferência sem processamento agendado'};
export function automaticReconciliationIssue(issue:string){
 if(issue==='initiator_access_changed')return 'O responsável pela importação perdeu a permissão financeira. É necessária uma nova conferência por alguém autorizado.';
 if(issue.startsWith('native_account_'))return 'A conta do arquivo não corresponde a um cadastro único e completo. Confira os dados da conta.';
 if(issue.startsWith('processing_error:'))return 'O processamento encontrou uma falha e precisa de revisão técnica.';
 return 'Uma nova conferência do original é necessária antes de continuar.';
}
