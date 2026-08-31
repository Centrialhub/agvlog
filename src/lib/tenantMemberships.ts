import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';

const roleSchema = z.enum(['owner', 'admin', 'operator', 'client', 'driver']);
const tenantFields = { name: z.string(), plan_key: z.string(), timezone: z.string() };
const operationalSchema = z.array(z.object({
  tenant_id: z.string().min(1), role: roleSchema, tenant_name: z.string(),
  plan_key: z.string(), timezone: z.string(),
}));
const portalSchema = z.array(z.object({ id: z.string().min(1), ...tenantFields }));
export interface Membership {
  tenant_id: string;
  role: z.infer<typeof roleSchema>;
  tenants: { id: string; name: string; plan_key: string; timezone: string };
}

// A single bounded read, including the portal-only fallback. Never call Auth
// methods inside onAuthStateChange: that callback executes under the Auth lock.
export async function readTenantMemberships(signal: AbortSignal): Promise<Membership[]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const { data, error } = await supabase.rpc('get_current_memberships_v1').abortSignal(controller.signal);
        if (error) throw error;
        const rows = operationalSchema.parse(data);
        if (rows.length) return rows.map(row => ({ tenant_id: row.tenant_id, role: row.role,
          tenants: { id: row.tenant_id, name: row.tenant_name, plan_key: row.plan_key, timezone: row.timezone } }));
        const portal = await supabase.rpc('get_user_portal_tenants').abortSignal(controller.signal);
        if (portal.error) throw portal.error;
        return portalSchema.parse(portal.data).map(tenant => ({ tenant_id: tenant.id, role: 'client' as const, tenants: tenant }));
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => {
        controller.abort(); reject(new Error('Tempo esgotado ao consultar seus acessos.'));
      }, 8000); }),
    ]);
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

const selectionKey = (actor: string) => `agvlog:tenant:v1:${actor}`;
export function readTenantSelection(actor: string): string | null {
  try { return localStorage.getItem(selectionKey(actor)) ?? localStorage.getItem('agvlog_tenant_id'); }
  catch { return null; }
}
export function saveTenantSelection(actor: string, tenant: string) {
  try { localStorage.setItem(selectionKey(actor), tenant); localStorage.removeItem('agvlog_tenant_id'); }
  catch { /* Tenant selection is a preference, never an authorization source. */ }
}
