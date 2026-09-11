import { corsHeaders } from './cors.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decodeJwtPayload(authorization: string | null): Record<string, unknown> | null {
  if (!authorization?.startsWith('Bearer ')) return null;
  const payload = authorization.slice(7).split('.')[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const parsed = JSON.parse(atob(padded));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Must be called only after the endpoint has cryptographically verified the JWT.
 * The header transports the UI selection; the signed claim prevents a caller from
 * changing that selection by forging only the header or request body.
 */
export function requireActiveTenant(
  req: Request,
  tenantId: unknown,
  responseHeaders: Record<string, string> = corsHeaders,
): Response | null {
  const requestedTenant = typeof tenantId === 'string' ? tenantId : '';
  const headerTenant = req.headers.get('x-agvlog-tenant-id')?.trim() || '';
  const claims = decodeJwtPayload(req.headers.get('Authorization'));
  const claimTenant = typeof claims?.active_tenant_id === 'string' ? claims.active_tenant_id : '';

  if (!UUID.test(requestedTenant) || headerTenant !== requestedTenant || claimTenant !== requestedTenant) {
    return new Response(JSON.stringify({ error: 'tenant_context_mismatch' }), {
      status: 409,
      headers: { ...responseHeaders, 'Content-Type': 'application/json' },
    });
  }
  return null;
}

export function activeTenantFromVerifiedRequest(req: Request): string | null {
  const headerTenant = req.headers.get('x-agvlog-tenant-id')?.trim() || '';
  const claims = decodeJwtPayload(req.headers.get('Authorization'));
  const claimTenant = typeof claims?.active_tenant_id === 'string' ? claims.active_tenant_id : '';
  return UUID.test(headerTenant) && headerTenant === claimTenant ? headerTenant : null;
}
