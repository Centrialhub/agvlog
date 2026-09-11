import {z} from 'zod';
import {statementIntakeResultSchema} from './statementImportContract';
const uuid=z.string().uuid(),money=z.number().int().min(-99999999999999).max(99999999999999);
export const statementSourceLabels={pending:'Original ainda não conferido',rows_match:'Linhas conferidas com o original',rows_mismatch:'Linhas divergem do original',unreadable:'Original exige revisão'} as const;
export const statementIdentityLabels={new:'Linha nova',duplicate:'Duplicidade por referência',ambiguous:'Coincidência a revisar',reference_conflict:'Referência com dados conflitantes',repeated_reference:'Referência repetida no arquivo'} as const;
export interface StatementListFilters {page:number;page_size:number;search:string;from:string;to:string;account_id:string;source_status:string}
export interface StatementLineFilters {page:number;page_size:number;classification:string}
export const statementSummarySchema=z.object({id:uuid,tenant_id:uuid,bank_account_id:uuid,account_name:z.string(),file_name:z.string(),file_hash:z.string(),source_path:z.string(),
  period_start:z.string(),period_end:z.string(),input_rows:z.number().int().nonnegative(),created_at:z.string(),
  source_verification:z.enum(['pending','rows_match','rows_mismatch','unreadable']),verification_report:z.record(z.unknown()).nullable(),
  counts:statementIntakeResultSchema.shape.counts,identity_review_count:z.number().int().nonnegative(),manual_review_count:z.number().int().nonnegative().default(0)});
export type StatementSummary=z.infer<typeof statementSummarySchema>;
export const statementListSchema=z.object({version:z.literal(1),tenant_id:uuid,page:z.number().int().positive(),page_size:z.number().int().positive(),total:z.number().int().nonnegative(),rows:z.array(statementSummarySchema)});
export const statementLinesSchema=z.object({version:z.literal(1),tenant_id:uuid,import_id:uuid,page:z.number().int().positive(),page_size:z.number().int().positive(),total:z.number().int().nonnegative(),
  row_amount_total_cents:z.string().regex(/^-?\d+$/),
  source_verification_id:uuid.nullable().optional(),
  rows:z.array(z.object({id:uuid,tenant_id:uuid,import_id:uuid,source_row:z.number().int().positive(),classification:z.enum(['new','duplicate','ambiguous','reference_conflict','repeated_reference']),
    bank_entry_id:uuid.nullable(),candidate_count:z.number().int().nonnegative(),posted_on:z.string(),amount_cents:money,description:z.string(),bank_id:z.string().nullable(),
    document_number:z.string().nullable(),counterparty_name:z.string().nullable(),counterparty_document:z.string().nullable(),source_cells:z.array(z.unknown()).nullable(),
    candidate_preview:z.array(z.object({id:uuid,posted_on:z.string(),amount_cents:money,description:z.string(),bank_id:z.string().nullable(),counterparty_name:z.string().nullable(),first_import_id:uuid})),
    manual_review:z.object({id:uuid,decision:z.enum(['same_transaction','distinct_transaction']),bank_entry_id:uuid,actor_id:uuid,actor_name:z.string(),reason:z.string(),created_at:z.string(),
      reversal:z.object({id:uuid,actor_id:uuid,actor_name:z.string(),reason:z.string(),created_at:z.string()}).nullable().optional()}).nullable().optional(),
  })),history:z.array(z.object({id:uuid,actor_id:uuid,actor_name:z.string(),action:z.string(),reason:z.string(),created_at:z.string()}))});
