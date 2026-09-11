export interface SupplierPortalJob {
  job_id: string;
  tenant_id: string;
  channel_id: string;
  receipt_id: string;
  supplier_key: string;
  adapter_key: string;
  idempotency_key: string;
  lease_token: string;
  lease_expires_at: string;
  payload: Record<string, unknown>;
  safe_configuration: Record<string, unknown>;
  verified_capabilities: Record<string, unknown>;
}

export interface SupplierPortalUnavailable {
  status: 'unavailable';
  errorCode: string;
}

/**
 * Deliberately contains no network transport. A supplier-specific adapter must
 * be implemented and reviewed before its catalog row can be enabled.
 */
export async function runSupplierPortalAdapter(job: SupplierPortalJob): Promise<SupplierPortalUnavailable> {
  if (job.adapter_key === 'supplier_portal_generic_v1') {
    return {status: 'unavailable', errorCode: 'generic_portal_adapter_disabled'};
  }
  return {status: 'unavailable', errorCode: 'supplier_portal_adapter_not_implemented'};
}
