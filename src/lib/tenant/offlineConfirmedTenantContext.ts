import { z } from 'zod';
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Membership } from '@/lib/tenantMemberships';

const uuid = z.string().uuid();
const claimsSchema = z.object({
  sub: uuid, role: z.literal('authenticated'), active_tenant_id: uuid,
  active_workspace_id: uuid, session_id: uuid, exp: z.number().int().positive(),
});
const driverSchema = z.object({
  tenant_id: uuid, role: z.literal('driver'),
  tenants: z.object({ id: uuid, name: z.string(), plan_key: z.string(), timezone: z.string() }).strict(),
}).strict();
const confirmationSchema = z.object({
  version: z.literal(1), actor_id: uuid, tenant_id: uuid, workspace_id: uuid,
  session_id: uuid, role: z.literal('driver'), token_expires_at: z.number().int().positive(),
  confirmed_at: z.string().datetime(), expires_at: z.string().datetime(), membership: driverSchema,
}).strict();
export type ConfirmedDriverContext = z.infer<typeof confirmationSchema>;
export const CONFIRMED_DRIVER_CONTEXT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const key = (actor: string) => `agvlog:confirmed-driver-context:v1:${actor}`;

function sessionClaims(actor: string, session: Session | null | undefined, now: Date) {
  if (session?.user?.id !== actor || !session.access_token || !Number.isFinite(now.getTime())) return null;
  try {
    const segments = session.access_token.split('.');
    if (segments.length !== 3 || segments.some(segment => !segment)) return null;
    const normalized = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const parsed = claimsSchema.safeParse(JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))));
    if (!parsed.success || parsed.data.sub !== actor || parsed.data.exp * 1000 <= now.getTime()) return null;
    if (session.expires_at !== undefined && (!Number.isFinite(session.expires_at) || session.expires_at * 1000 <= now.getTime())) return null;
    return parsed.data;
  } catch { return null; }
}

export function clearConfirmedDriverContext(actor: string | undefined): void {
  if (!actor) return;
  try { localStorage.removeItem(key(actor)); } catch { /* Optional local bootstrap. */ }
}

/** Stage only after a successful live membership read; this is not a JWT verifier. */
export function stageConfirmedDriverContext(actor: string, session: Session | null | undefined, memberships: Membership[], now = new Date()): ConfirmedDriverContext | null {
  const claims = sessionClaims(actor, session, now);
  const candidates = claims ? memberships.filter(row => row.tenant_id === claims.active_tenant_id) : [];
  const membership = candidates.length === 1 ? driverSchema.safeParse(candidates[0]) : null;
  if (!claims || !membership?.success || membership.data.tenants.id !== claims.active_tenant_id) return null;
  const expires = Math.min(claims.exp * 1000, session?.expires_at ? session.expires_at * 1000 : Infinity, now.getTime() + CONFIRMED_DRIVER_CONTEXT_TTL_MS);
  return confirmationSchema.parse({
    version: 1, actor_id: actor, tenant_id: claims.active_tenant_id, workspace_id: claims.active_workspace_id,
    session_id: claims.session_id, role: 'driver', token_expires_at: claims.exp,
    confirmed_at: now.toISOString(), expires_at: new Date(expires).toISOString(), membership: membership.data,
  });
}

function matchesSession(value: ConfirmedDriverContext, actor: string, session: Session | null | undefined, now: Date): boolean {
  const claims = sessionClaims(actor, session, now);
  const confirmed = Date.parse(value.confirmed_at), expires = Date.parse(value.expires_at);
  return !!claims && value.actor_id === actor && value.tenant_id === claims.active_tenant_id
    && value.workspace_id === claims.active_workspace_id && value.session_id === claims.session_id
    && value.token_expires_at <= claims.exp
    && value.membership.tenant_id === value.tenant_id && value.membership.tenants.id === value.tenant_id
    && confirmed <= now.getTime() && expires > now.getTime()
    && expires <= confirmed + CONFIRMED_DRIVER_CONTEXT_TTL_MS && expires <= value.token_expires_at * 1000;
}

/** Commit only when the provider's signed tenant/role confirmation has settled. */
export function commitConfirmedDriverContext(value: ConfirmedDriverContext | null, actor: string | undefined, session: Session | null | undefined, view: { tenant: string | undefined; role: string | undefined }, now = new Date()): void {
  const parsed = confirmationSchema.safeParse(value);
  if (!parsed.success || !actor || view.tenant !== parsed.data.tenant_id || view.role !== 'driver' || !matchesSession(parsed.data, actor, session, now)) return;
  // The staged timestamps are retained. Fallback/re-render never extends TTL.
  try { localStorage.setItem(key(actor), JSON.stringify(parsed.data)); } catch { /* Optional local bootstrap. */ }
}

function readConfirmation(actor: string, session: Session | null | undefined, now = new Date()): ConfirmedDriverContext | null {
  try {
    const raw = localStorage.getItem(key(actor));
    if (!raw) return null;
    const parsed = confirmationSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || !matchesSession(parsed.data, actor, session, now)) {
      clearConfirmedDriverContext(actor); return null;
    }
    return parsed.data;
  } catch { clearConfirmedDriverContext(actor); return null; }
}


export function readConfirmedDriverContext(actor: string, session: Session | null | undefined, now = new Date()): Membership | null {
  return readConfirmation(actor, session, now)?.membership ?? null;
}

/** A mounted transport fallback must lose its scope at the original deadline. */
export function useConfirmedDriverFallback(actor: string | undefined, session: Session | null | undefined) {
  const [proof, setProof] = useState<ConfirmedDriverContext | null>(null);
  const [invalidated, setInvalidated] = useState(false);
  const [, tick] = useState(0);
  const report = useCallback((next: ConfirmedDriverContext | null) => { setProof(next); setInvalidated(false); }, []);
  const valid = !proof || (!invalidated && !!actor && matchesSession(proof, actor, session, new Date()));
  useEffect(() => {
    if (proof && !valid) clearConfirmedDriverContext(proof.actor_id);
  }, [proof, valid]);
  useEffect(() => {
    if (!proof || !actor) return;
    const wake = () => {
      if (!readConfirmation(actor, session)) setInvalidated(true);
      tick(value => value + 1);
    };
    const claims = sessionClaims(actor, session, new Date());
    const deadline = Math.min(Date.parse(proof.expires_at), claims ? claims.exp * 1000 : Date.now(), session?.expires_at === undefined ? Infinity : session.expires_at * 1000);
    const timer = setTimeout(wake, Math.max(0, deadline - Date.now()));
    const storage = (event: StorageEvent) => { if (event.key === key(actor) || event.key === null) wake(); };
    window.addEventListener('focus', wake); window.addEventListener('pageshow', wake);
    window.addEventListener('storage', storage); document.addEventListener('visibilitychange', wake);
    return () => {
      clearTimeout(timer); window.removeEventListener('focus', wake); window.removeEventListener('pageshow', wake);
      window.removeEventListener('storage', storage); document.removeEventListener('visibilitychange', wake);
    };
  }, [actor, session, proof]);
  return { valid, report };
}

interface MembershipReadPorts {
  actor: string | undefined;
  session: Session | null | undefined;
  currentIdentity: () => { actor: string | undefined; session: Session | null | undefined };
  online: boolean;
  signal: AbortSignal;
  readFresh: (signal: AbortSignal) => Promise<Membership[]>;
  readOffline: (actor: string) => Membership[] | null;
  saveFresh: (actor: string, memberships: Membership[]) => void;
  isTransportFailure: (cause: unknown) => boolean;
  stage: (confirmation: ConfirmedDriverContext | null) => void;
  reportFallback?: (confirmation: ConfirmedDriverContext | null) => void;
}

export async function readMembershipsWithConfirmedDriverContext(ports: MembershipReadPorts): Promise<Membership[]> {
  const { actor, session, online, signal } = ports;
  ports.stage(null);
  if (!actor) return [];
  const ownsRead = () => {
    const current = ports.currentIdentity();
    return !signal.aborted && current.actor === actor && current.session?.access_token === session?.access_token;
  };
  if (!online) {
    const cached = ports.readOffline(actor);
    if (!ownsRead()) throw new DOMException('Membership context changed', 'AbortError');
    if (!cached) throw new Error('Nenhum acesso validado está disponível offline.');
    ports.reportFallback?.(null);
    return cached;
  }
  let fresh: Membership[];
  try { fresh = await ports.readFresh(signal); }
  catch (cause) {
    if (!ownsRead()) throw cause;
    if (ports.isTransportFailure(cause)) {
      const confirmed = readConfirmation(actor, session);
      if (confirmed) { ports.reportFallback?.(confirmed); return [confirmed.membership]; }
    } else clearConfirmedDriverContext(actor);
    throw cause;
  }
  if (!ownsRead()) throw new DOMException('Membership context changed', 'AbortError');
  ports.reportFallback?.(null);
  ports.saveFresh(actor, fresh);
  const confirmation = stageConfirmedDriverContext(actor, session, fresh);
  if (!confirmation) clearConfirmedDriverContext(actor);
  ports.stage(confirmation);
  return fresh;
}
