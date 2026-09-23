import {z} from 'zod';
const uuid=z.string().uuid(),date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/),revision=z.string().regex(/^[a-f0-9]{32,64}$/);
export const accountPeriodEvidenceSchema=z.object({version:z.literal(1),tenant_id:uuid,account_id:uuid,closure_id:uuid,closure:z.object({from:date,to:date,revision,actor_id:uuid,actor_name:z.string(),reason:z.string(),created_at:z.string()}).passthrough(),snapshot:z.record(z.unknown()),dependencies:z.array(z.record(z.unknown())),integrity:z.object({snapshot_matches_revision:z.boolean(),dependencies_match:z.boolean()}).passthrough(),reopening:z.object({id:uuid,actor_id:uuid,actor_name:z.string(),reason:z.string(),created_at:z.string()}).passthrough().nullable()}).passthrough();
const evidencePageSchema=z.object({offset:z.number().int().nonnegative(),limit:z.number().int().min(1).max(100),total:z.number().int().nonnegative()});
export const accountPeriodEvidencePageSchema=accountPeriodEvidenceSchema.extend({movement_page:evidencePageSchema,dependency_page:evidencePageSchema,movement_receipt_summary:z.object({identified:z.number().int().nonnegative(),missing:z.number().int().nonnegative()})});
export type AccountPeriodEvidence=z.infer<typeof accountPeriodEvidenceSchema>;
export type AccountPeriodEvidencePage=z.infer<typeof accountPeriodEvidencePageSchema>;
export function exportAccountPeriodEvidence(data:AccountPeriodEvidence){return JSON.stringify(accountPeriodEvidenceSchema.parse(data),null,2);}
