import { z } from 'zod';

const uuid = z.string().uuid();

export const portalFiscalDocumentSchema = z.object({
  kind: z.enum(['cte', 'nfse']),
  id: uuid,
  number: z.string().nullable(),
  series: z.string().nullable(),
  issued_at: z.string().nullable(),
  status: z.string().nullable(),
  issuer: z.string().nullable(),
  recipient: z.string().nullable(),
  amount: z.number().nullable(),
  available_files: z.object({ pdf: z.boolean(), xml: z.boolean() }),
});

export type PortalFiscalDocument = z.infer<typeof portalFiscalDocumentSchema>;
export type PortalFiscalFileFormat = 'pdf' | 'xml';

export const portalFiscalBundleSchema = z.object({
  context: z.object({
    tenant_id: uuid,
    actor_id: uuid,
    document_id: uuid,
  }),
  can_download_documents: z.boolean(),
  documents: z.array(portalFiscalDocumentSchema),
});

export type PortalFiscalBundle = z.infer<typeof portalFiscalBundleSchema>;

const portalFiscalFileSchema = z.discriminatedUnion('source', [
  z.object({
    context: z.object({ tenant_id: uuid, actor_id: uuid, document_id: uuid }),
    kind: z.enum(['cte', 'nfse']),
    fiscal_document_id: uuid,
    document_id: uuid,
    format: z.enum(['pdf', 'xml']),
    source: z.literal('url'),
    filename: z.string().min(1),
    url: z.string().url(),
  }),
  z.object({
    context: z.object({ tenant_id: uuid, actor_id: uuid, document_id: uuid }),
    kind: z.enum(['cte', 'nfse']),
    fiscal_document_id: uuid,
    document_id: uuid,
    format: z.literal('xml'),
    source: z.literal('inline'),
    filename: z.string().min(1),
    content: z.string().min(1),
  }),
]);

export type PortalFiscalFile = z.infer<typeof portalFiscalFileSchema>;

export function parsePortalFiscalBundle(
  value: unknown,
  expected: { tenantId: string; actorId: string; documentId: string },
): PortalFiscalBundle {
  const result = portalFiscalBundleSchema.parse(value);
  if (
    result.context.tenant_id !== expected.tenantId
    || result.context.actor_id !== expected.actorId
    || result.context.document_id !== expected.documentId
  ) {
    throw new Error('O servidor não confirmou o catálogo fiscal para esta sessão.');
  }
  return result;
}

export function parsePortalFiscalFile(
  value: unknown,
  expected: {
    tenantId: string;
    actorId: string;
    fiscalDocumentId: string;
    documentId: string;
    kind: PortalFiscalDocument['kind'];
    format: PortalFiscalFileFormat;
  },
): PortalFiscalFile {
  const result = portalFiscalFileSchema.parse(value);
  if (
    result.context.tenant_id !== expected.tenantId
    || result.context.actor_id !== expected.actorId
    || result.context.document_id !== expected.fiscalDocumentId
    || result.fiscal_document_id !== expected.fiscalDocumentId
    || result.document_id !== expected.documentId
    || result.kind !== expected.kind
    || result.format !== expected.format
  ) {
    throw new Error('O servidor não confirmou o arquivo fiscal para esta sessão.');
  }
  return result;
}
