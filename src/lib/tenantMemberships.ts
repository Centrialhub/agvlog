import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';

const roleSchema = z.enum(['owner', 'admin', 'operator', 'client', 'driver']);
const tenantFields = { name: z.string(), plan_key: z.string(), timezone: z.string() };
const operationalSchema = z.array(z.object({
  tenant_id: z.string().min(1), role: roleSchema, tenant_name: z.string(),
  plan_key: z.string(), timezone: z.string(),
}));
const portalSchema = z.array(z.object({ id: z.string().min(1), ...tenantFields }));
const membershipCacheSchema = z.object({
  version: z.literal(1), actor_id: z.string().min(1), cached_at: z.string().datetime(),
  expires_at: z.string().datetime(), memberships: z.array(z.object({
    tenant_id: z.string().min(1), role: roleSchema,
    tenants: z.object({ id: z.string().min(1), ...tenantFields }),
  })),
}).strict();
export interface Membership {
  tenant_id: string;
  role: z.infer<typeof roleSchema>;
  tenants: { id: string; name: string; plan_key: string; timezone: string };
}

const MEMBERSHIP_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const membershipCacheKey = (actor: string) => `agvlog:memberships:v1:${actor}`;

/**
 * This cache is only an offline UI bootstrap. Server authorization and the
 * signed tenant claim remain authoritative for every synchronized command.
 */
export function saveTenantMembershipCache(actor: string, memberships: Membership[], now = new Date()): void {
  const cachedAt = now.toISOString();
  const value = membershipCacheSchema.parse({
    version: 1, actor_id: actor, cached_at: cachedAt,
    expires_at: new Date(now.getTime() + MEMBERSHIP_CACHE_MAX_AGE_MS).toISOString(), memberships,
  });
  try { localStorage.setItem(membershipCacheKey(actor), JSON.stringify(value)); }
  catch { /* Offline authorization bootstrap remains optional. */ }
}

export function readTenantMembershipCache(actor: string, now = new Date()): Membership[] | null {
  try {
    const raw = localStorage.getItem(membershipCacheKey(actor));
    if (!raw) return null;
    const parsed = membershipCacheSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.actor_id !== actor || new Date(parsed.data.expires_at) <= now) {
      localStorage.removeItem(membershipCacheKey(actor));
      return null;
    }
    return parsed.data.memberships;
  } catch {
    try { localStorage.removeItem(membershipCacheKey(actor)); } catch { /* optional cache */ }
    return null;
  }
}

export function clearTenantMembershipCache(actor: string | undefined): void {
  if (!actor) return;
  try { localStorage.removeItem(membershipCacheKey(actor)); } catch { /* optional cache */ }
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
