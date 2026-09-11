import {z} from 'zod';

const amount=z.string().regex(/^-?\d+(?:\.\d+)?$/);
export const payrollPaymentIssues:Record<string,string>={
  missing_title:'Conta a pagar ausente',multiple_titles:'Mais de um título para esta folha',
  title_amount_mismatch:'Valor do título difere da folha',cancelled_title:'Título cancelado',
  wrong_category:'Título com categoria incorreta',invalid_payment_amount:'Pagamento com valor inválido',
  overpaid:'Pagamento acima do saldo',cancelled_entry_with_payment:'Folha cancelada com pagamento',
  unexpected_title:'Título criado antes da aprovação da folha',
};
export const payrollPaymentLabels:Record<string,string>={unpaid:'Não paga',partial:'Parcial',paid:'Paga',review:'Conferir',cancelled:'Cancelada'};
export const payrollPaymentSummarySchema=z.object({
  obligation_amount:amount,paid_via_titles:amount,remaining_amount:amount,overpaid_amount:amount,
  title_count:z.number().int().nonnegative(),issues:z.array(z.string()),
  status:z.enum(['unpaid','partial','paid','review','cancelled']),bank_confirmation:z.literal('not_evaluated'),
});
export type PayrollPaymentSummary=z.infer<typeof payrollPaymentSummarySchema>;
export const payrollPeriodsProjectionSchema=z.object({version:z.literal(1),tenant_id:z.string().uuid(),rows:z.array(z.object({
  id:z.string().uuid(),tenant_id:z.string().uuid(),status:z.string(),payment_status:payrollPaymentSummarySchema.shape.status,
  remaining_amount:amount,payment_issues_count:z.number().int().nonnegative(),bank_confirmation:z.literal('not_evaluated'),
}).passthrough())});
export const payrollProjectionSchema=z.object({version:z.literal(1),tenant_id:z.string().uuid(),period_id:z.string().uuid(),
  rows:z.array(z.object({id:z.string().uuid(),tenant_id:z.string().uuid(),payroll_period_id:z.string().uuid(),
    employee_id:z.string().uuid(),status:z.string(),gross_amount:z.number(),discount_amount:z.number(),
    already_paid_amount:z.number(),amount_to_pay:z.number(),payment_summary:payrollPaymentSummarySchema,
    employees:z.object({name:z.string().nullable(),doc_cpf:z.string().nullable(),branch:z.string().nullable(),department:z.string().nullable()}),
  }).passthrough()),
});
