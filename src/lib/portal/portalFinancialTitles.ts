import { z } from 'zod';

const uuid = z.string().uuid();

export const portalFinancialTitleSchema = z.object({
  id: uuid,
  client_id: uuid,
  client_name: z.string(),
  fiscal_document_id: uuid.nullable(),
  load_id: uuid.nullable(),
  description: z.string().nullable(),
  invoice_number: z.string().nullable(),
  amount: z.number(),
  received_amount: z.number(),
  outstanding_amount: z.number(),
  due_date: z.string().nullable(),
  status: z.string(),
  received_at: z.string().nullable(),
  client_invoice_id: uuid.nullable(),
  billing_issue_date: z.string().nullable(),
  billing_status: z.string().nullable(),
  billing_total_amount: z.number(),
  has_pdf: z.boolean(),
  can_download: z.boolean(),
});

export type PortalFinancialTitle = z.infer<typeof portalFinancialTitleSchema>;

const portalFinancialTitlesSchema = z.object({
  context: z.object({
    tenant_id: uuid,
    actor_id: uuid,
    client_id: uuid.nullable(),
  }),
  rows: z.array(portalFinancialTitleSchema),
  total: z.number().int().nonnegative(),
  revision: z.string().min(1),
});

const portalFinancialTitleFileSchema = z.object({
  context: z.object({ tenant_id: uuid, actor_id: uuid, title_id: uuid }),
  source: z.literal('url'),
  filename: z.string().min(1),
  url: z.string().url(),
});

export function parsePortalFinancialTitles(
  value: unknown,
  expected: { tenantId: string; actorId: string; clientId: string | null },
) {
  const result = portalFinancialTitlesSchema.parse(value);
  if (
    result.context.tenant_id !== expected.tenantId
    || result.context.actor_id !== expected.actorId
    || result.context.client_id !== expected.clientId
  ) {
    throw new Error('O servidor não confirmou os títulos para esta sessão.');
  }
  return result;
}

export function parsePortalFinancialTitleFile(
  value: unknown,
  expected: { tenantId: string; actorId: string; titleId: string },
) {
  const result = portalFinancialTitleFileSchema.parse(value);
  if (
    result.context.tenant_id !== expected.tenantId
    || result.context.actor_id !== expected.actorId
    || result.context.title_id !== expected.titleId
  ) {
    throw new Error('O servidor não confirmou o arquivo do título para esta sessão.');
  }
  return result;
}
