import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';

export const receiptScanQualityThresholdsSchema = z.object({
  min_source_pixels: z.number().int().min(250_000).max(50_000_000),
  min_processed_short_side: z.number().int().min(300).max(5_000),
  min_brightness_reject: z.number().min(0).max(254),
  min_brightness_warn: z.number().min(0).max(254),
  max_brightness_reject: z.number().min(1).max(255),
  max_glare_warn: z.number().min(0).max(1),
  min_contrast_reject: z.number().min(0).max(255),
  min_contrast_warn: z.number().min(0).max(255),
  min_sharpness_reject: z.number().min(0).max(100),
  min_sharpness_warn: z.number().min(0).max(100),
  edge_cut_action: z.enum(['warn', 'reject']),
}).strict().superRefine((value, context) => {
  if (value.min_brightness_reject > value.min_brightness_warn
    || value.min_brightness_warn >= value.max_brightness_reject) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Os limites de iluminação estão fora de ordem.' });
  }
  if (value.min_contrast_reject > value.min_contrast_warn) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Os limites de contraste estão fora de ordem.' });
  }
  if (value.min_sharpness_reject > value.min_sharpness_warn) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Os limites de nitidez estão fora de ordem.' });
  }
});

export type ReceiptScanQualityThresholds = z.infer<typeof receiptScanQualityThresholdsSchema>;

export const BASELINE_RECEIPT_SCAN_QUALITY_THRESHOLDS: ReceiptScanQualityThresholds = Object.freeze({
  min_source_pixels: 2_000_000,
  min_processed_short_side: 900,
  min_brightness_reject: 38,
  min_brightness_warn: 58,
  max_brightness_reject: 248,
  max_glare_warn: 0.08,
  min_contrast_reject: 8,
  min_contrast_warn: 16,
  min_sharpness_reject: 2,
  min_sharpness_warn: 3.5,
  edge_cut_action: 'warn',
});

export const receiptScanQualityPolicySchema = z.object({
  source: z.enum(['client', 'tenant', 'baseline']),
  policy_id: z.string().uuid().nullable(),
  version: z.number().int().positive(),
  tenant_id: z.string().uuid(),
  client_id: z.string().uuid().nullable(),
  thresholds: receiptScanQualityThresholdsSchema,
  resolved_at: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if ((value.source === 'baseline') !== (value.policy_id === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'A origem não corresponde ao identificador da política.' });
  }
});

export type ReceiptScanQualityPolicy = z.infer<typeof receiptScanQualityPolicySchema>;

const policyRowSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  client_id: z.string().uuid().nullable(),
  client_name: z.string().nullable(),
  scope: z.enum(['client', 'tenant']),
  version: z.number().int().positive(),
  thresholds: receiptScanQualityThresholdsSchema,
  is_active: z.boolean(),
  created_at: z.string().datetime({ offset: true }),
  created_by: z.string().uuid(),
  retired_at: z.string().datetime({ offset: true }).nullable(),
}).strict();

const policyPageSchema = z.object({
  version: z.literal(1),
  tenant_id: z.string().uuid(),
  actor_id: z.string().uuid(),
  baseline: receiptScanQualityThresholdsSchema,
  rows: z.array(policyRowSchema),
}).strict();

export type ReceiptScanQualityPolicyRow = z.infer<typeof policyRowSchema>;
export type ReceiptScanQualityPolicyPage = z.infer<typeof policyPageSchema>;

const savedPolicySchema = z.object({
  id: z.string().uuid(), client_id: z.string().uuid().nullable(), scope: z.enum(['client', 'tenant']),
  version: z.number().int().positive(), thresholds: receiptScanQualityThresholdsSchema,
  updated_at: z.string().datetime({ offset: true }), confirmed: z.literal(true),
}).strict();
const retiredPolicySchema = z.object({ id: z.string().uuid(), retired: z.literal(true), confirmed: z.literal(true) }).strict();
const cacheSchema = z.object({ version: z.literal(1), stored_at: z.string().datetime({ offset: true }), policy: receiptScanQualityPolicySchema }).strict();
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

type QualityPolicyRpcArgs = {
  resolve_delivery_receipt_quality_policy_v1: { _stop_id: string };
  list_delivery_receipt_quality_policies_v1: { _tenant_id: string };
  save_delivery_receipt_quality_policy_v1: {
    _tenant_id: string; _client_id: string | null; _thresholds: ReceiptScanQualityThresholds;
    _expected_active_policy_id: string | null;
  };
  retire_delivery_receipt_quality_policy_v1: {
    _tenant_id: string; _client_id: string | null; _expected_active_policy_id: string;
  };
};
interface RpcResponse { data: unknown; error: { code?: string; message?: string } | null }
const rpc = supabase.rpc as unknown as <Name extends keyof QualityPolicyRpcArgs>(
  name: Name,
  args: QualityPolicyRpcArgs[Name],
) => PromiseLike<RpcResponse>;

function cacheKey(tenantId: string, clientId: string | null) {
  return `agvlog:receipt-quality-policy:v1:${tenantId}:${clientId ?? 'tenant-default'}`;
}

export function baselineReceiptScanQualityPolicy(
  tenantId: string,
  clientId: string | null,
  now = new Date(),
): ReceiptScanQualityPolicy {
  return {
    source: 'baseline', policy_id: null, version: 1, tenant_id: tenantId, client_id: clientId,
    thresholds: { ...BASELINE_RECEIPT_SCAN_QUALITY_THRESHOLDS }, resolved_at: now.toISOString(),
  };
}

export function readCachedReceiptScanQualityPolicy(
  tenantId: string,
  clientId: string | null,
  storage: Pick<Storage, 'getItem' | 'removeItem'> = localStorage,
  now = Date.now(),
): ReceiptScanQualityPolicy | null {
  try {
    const raw = storage.getItem(cacheKey(tenantId, clientId));
    if (!raw) return null;
    const parsed = cacheSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.policy.tenant_id !== tenantId
      || parsed.data.policy.client_id !== clientId
      || now - Date.parse(parsed.data.stored_at) > CACHE_MAX_AGE_MS) {
      storage.removeItem(cacheKey(tenantId, clientId));
      return null;
    }
    return parsed.data.policy;
  } catch {
    return null;
  }
}

export function cacheReceiptScanQualityPolicy(
  policy: ReceiptScanQualityPolicy,
  storage: Pick<Storage, 'setItem'> = localStorage,
  now = new Date(),
) {
  try {
    storage.setItem(cacheKey(policy.tenant_id, policy.client_id), JSON.stringify({ version: 1, stored_at: now.toISOString(), policy }));
  } catch {
    // The baseline remains usable when preference storage is restricted.
  }
}

export async function resolveReceiptScanQualityPolicy(
  tenantId: string,
  clientId: string | null,
  stopId: string,
): Promise<ReceiptScanQualityPolicy> {
  const cached = typeof localStorage === 'undefined' ? null : readCachedReceiptScanQualityPolicy(tenantId, clientId);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return cached ?? baselineReceiptScanQualityPolicy(tenantId, clientId);
  }
  const { data, error } = await rpc('resolve_delivery_receipt_quality_policy_v1', { _stop_id: stopId });
  if (error) {
    if (error.code === '42501' || /not_authorized|permission denied/i.test(error.message ?? '')) throw error;
    return cached ?? baselineReceiptScanQualityPolicy(tenantId, clientId);
  }
  const policy = receiptScanQualityPolicySchema.parse(data);
  if (policy.tenant_id !== tenantId || policy.client_id !== clientId) {
    throw new Error('A política de qualidade não pertence à parada selecionada.');
  }
  if (typeof localStorage !== 'undefined') cacheReceiptScanQualityPolicy(policy);
  return policy;
}

export async function listReceiptScanQualityPolicies(tenantId: string, actorId: string) {
  const { data, error } = await rpc('list_delivery_receipt_quality_policies_v1', { _tenant_id: tenantId });
  if (error) throw error;
  const page = policyPageSchema.parse(data);
  if (page.tenant_id !== tenantId || page.actor_id !== actorId) throw new Error('Políticas incompatíveis com a sessão atual.');
  return page;
}

export async function saveReceiptScanQualityPolicy(input: {
  tenantId: string; clientId: string | null; thresholds: ReceiptScanQualityThresholds; expectedActivePolicyId: string | null;
}) {
  const thresholds = receiptScanQualityThresholdsSchema.parse(input.thresholds);
  const { data, error } = await rpc('save_delivery_receipt_quality_policy_v1', {
    _tenant_id: input.tenantId, _client_id: input.clientId, _thresholds: thresholds,
    _expected_active_policy_id: input.expectedActivePolicyId,
  });
  if (error) throw error;
  return savedPolicySchema.parse(data);
}

export async function retireReceiptScanQualityPolicy(input: {
  tenantId: string; clientId: string | null; expectedActivePolicyId: string;
}) {
  const { data, error } = await rpc('retire_delivery_receipt_quality_policy_v1', {
    _tenant_id: input.tenantId, _client_id: input.clientId,
    _expected_active_policy_id: input.expectedActivePolicyId,
  });
  if (error) throw error;
  return retiredPolicySchema.parse(data);
}

export function receiptQualityPolicyError(cause: unknown) {
  const message = cause instanceof Error ? cause.message
    : cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : '';
  if (/not_authorized|permission denied|42501/i.test(message)) return 'Sua sessão não pode administrar estas regras.';
  if (/changed|40001|duplicate/i.test(message)) return 'A política foi alterada por outra pessoa. Atualize antes de salvar.';
  if (/invalid.*threshold|check constraint|22023/i.test(message)) return 'Revise os limites; valores de alerta devem ser menos severos que os de rejeição.';
  return message || 'Não foi possível atualizar a política de qualidade.';
}
