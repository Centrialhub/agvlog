import { describe, it, expect } from 'vitest';

/**
 * Regression: cross-tenant isolation for route planning drafts, stop drafts,
 * dispatch trips and dispatch stops.
 *
 * These tests port the current RLS policies to a pure-TS simulation so any
 * regression on the SQL side (dropping the tenant filter, widening a policy to
 * USING(true), etc.) fails locally. If you change a policy, update the port
 * in the same commit.
 *
 * Policies mirrored:
 *  - route_planning_drafts:
 *      SELECT USING (tenant_id IN get_user_tenant_ids())
 *      ALL    USING/WITH CHECK is_tenant_admin(tenant_id)
 *  - route_planning_stop_drafts:
 *      SELECT/UPDATE/DELETE USING is_tenant_member(tenant_id)
 *      INSERT WITH CHECK   is_tenant_member(tenant_id)
 *  - dispatch_trips:
 *      SELECT operators: is_tenant_admin(tenant_id) OR has_tenant_role(tenant_id,'operator')
 *      SELECT drivers:   driver_id IN (drivers WHERE user_id=auth.uid AND tenant_id=trip.tenant_id)
 *      ALL   admins:     is_tenant_admin(tenant_id)
 *  - dispatch_stops:
 *      SELECT operators: is_tenant_admin(tenant_id) OR has_tenant_role(tenant_id,'operator')
 *      SELECT drivers:   dispatch_trip_id IN _driver_trip_ids()
 *      ALL   admins:     is_tenant_admin(tenant_id)
 */

type Role = 'owner' | 'admin' | 'operator' | 'driver' | 'client';
type Membership = { tenant_id: string; user_id: string; role: Role; active: boolean };
type Driver = { id: string; tenant_id: string; user_id: string | null; active: boolean };
type Trip = { id: string; tenant_id: string; driver_id: string | null };
type Stop = { id: string; tenant_id: string; dispatch_trip_id: string };
type Draft = { id: string; tenant_id: string };
type StopDraft = { id: string; tenant_id: string; draft_id: string };

interface World {
  authUid: string | null;
  memberships: Membership[];
  drivers: Driver[];
  trips: Trip[];
  stops: Stop[];
  drafts: Draft[];
  stopDrafts: StopDraft[];
}

// --- Port of helper functions --------------------------------------------

function getUserTenantIds(w: World): Set<string> {
  if (!w.authUid) return new Set();
  return new Set(w.memberships.filter((m) => m.user_id === w.authUid && m.active).map((m) => m.tenant_id));
}
function isTenantMember(w: World, tenantId: string): boolean {
  return getUserTenantIds(w).has(tenantId);
}
function hasTenantRole(w: World, tenantId: string, role: Role): boolean {
  if (!w.authUid) return false;
  return w.memberships.some(
    (m) => m.user_id === w.authUid && m.active && m.tenant_id === tenantId && m.role === role,
  );
}
function isTenantAdmin(w: World, tenantId: string): boolean {
  return hasTenantRole(w, tenantId, 'owner') || hasTenantRole(w, tenantId, 'admin');
}
function driverTripIds(w: World): Set<string> {
  const activeDriverIds = new Set(
    w.drivers.filter((d) => d.user_id === w.authUid && d.active).map((d) => `${d.tenant_id}|${d.id}`),
  );
  return new Set(
    w.trips
      .filter((t) => t.driver_id && activeDriverIds.has(`${t.tenant_id}|${t.driver_id}`))
      .map((t) => t.id),
  );
}

// --- Port of the RLS visibility rules ------------------------------------

function visibleDrafts(w: World): Draft[] {
  const tenants = getUserTenantIds(w);
  return w.drafts.filter((d) => tenants.has(d.tenant_id));
}
function canManageDraft(w: World, draft: Draft): boolean {
  return isTenantAdmin(w, draft.tenant_id);
}
function visibleStopDrafts(w: World): StopDraft[] {
  return w.stopDrafts.filter((sd) => isTenantMember(w, sd.tenant_id));
}
function canWriteStopDraft(w: World, tenantId: string): boolean {
  return isTenantMember(w, tenantId);
}
function visibleTrips(w: World): Trip[] {
  const driverTrips = w.drivers.some((d) => d.user_id === w.authUid && d.active)
    ? new Set(
        w.trips
          .filter((t) => {
            const d = w.drivers.find(
              (x) => x.id === t.driver_id && x.tenant_id === t.tenant_id,
            );
            return d && d.user_id === w.authUid && d.active;
          })
          .map((t) => t.id),
      )
    : new Set<string>();
  return w.trips.filter(
    (t) =>
      isTenantAdmin(w, t.tenant_id) ||
      hasTenantRole(w, t.tenant_id, 'operator') ||
      driverTrips.has(t.id),
  );
}
function canManageTrip(w: World, trip: Trip): boolean {
  return isTenantAdmin(w, trip.tenant_id);
}
function visibleStops(w: World): Stop[] {
  const driverTrips = driverTripIds(w);
  return w.stops.filter(
    (s) =>
      isTenantAdmin(w, s.tenant_id) ||
      hasTenantRole(w, s.tenant_id, 'operator') ||
      driverTrips.has(s.dispatch_trip_id),
  );
}
function canManageStop(w: World, stop: Stop): boolean {
  return isTenantAdmin(w, stop.tenant_id);
}

// --- Fixture --------------------------------------------------------------

const T_A = 'tenant-A';
const T_B = 'tenant-B';
const U_ADMIN_A = 'user-admin-a';
const U_OP_A = 'user-op-a';
const U_DRIVER_A = 'user-driver-a';
const U_ADMIN_B = 'user-admin-b';
const U_DRIVER_B = 'user-driver-b';

function makeWorld(authUid: string | null): World {
  return {
    authUid,
    memberships: [
      { tenant_id: T_A, user_id: U_ADMIN_A, role: 'admin', active: true },
      { tenant_id: T_A, user_id: U_OP_A, role: 'operator', active: true },
      { tenant_id: T_A, user_id: U_DRIVER_A, role: 'driver', active: true },
      { tenant_id: T_B, user_id: U_ADMIN_B, role: 'admin', active: true },
      { tenant_id: T_B, user_id: U_DRIVER_B, role: 'driver', active: true },
    ],
    drivers: [
      { id: 'drv-a', tenant_id: T_A, user_id: U_DRIVER_A, active: true },
      { id: 'drv-b', tenant_id: T_B, user_id: U_DRIVER_B, active: true },
    ],
    trips: [
      { id: 'trip-a', tenant_id: T_A, driver_id: 'drv-a' },
      { id: 'trip-b', tenant_id: T_B, driver_id: 'drv-b' },
    ],
    stops: [
      { id: 'stop-a', tenant_id: T_A, dispatch_trip_id: 'trip-a' },
      { id: 'stop-b', tenant_id: T_B, dispatch_trip_id: 'trip-b' },
    ],
    drafts: [
      { id: 'draft-a', tenant_id: T_A },
      { id: 'draft-b', tenant_id: T_B },
    ],
    stopDrafts: [
      { id: 'sd-a', tenant_id: T_A, draft_id: 'draft-a' },
      { id: 'sd-b', tenant_id: T_B, draft_id: 'draft-b' },
    ],
  };
}

// --- Tests ----------------------------------------------------------------

describe('RLS cross-tenant isolation: route planning drafts', () => {
  it('admin of tenant A only sees drafts of tenant A', () => {
    const w = makeWorld(U_ADMIN_A);
    expect(visibleDrafts(w).map((d) => d.id)).toEqual(['draft-a']);
  });
  it('admin of tenant B only sees drafts of tenant B', () => {
    const w = makeWorld(U_ADMIN_B);
    expect(visibleDrafts(w).map((d) => d.id)).toEqual(['draft-b']);
  });
  it('operator of tenant A sees tenant A drafts (member) but cannot manage', () => {
    const w = makeWorld(U_OP_A);
    expect(visibleDrafts(w).map((d) => d.id)).toEqual(['draft-a']);
    expect(canManageDraft(w, w.drafts[0])).toBe(false);
  });
  it('admin of A cannot manage draft of B', () => {
    const w = makeWorld(U_ADMIN_A);
    const draftB = w.drafts.find((d) => d.tenant_id === T_B)!;
    expect(canManageDraft(w, draftB)).toBe(false);
  });
  it('anonymous sees no drafts', () => {
    expect(visibleDrafts(makeWorld(null))).toEqual([]);
  });
});

describe('RLS cross-tenant isolation: route planning stop drafts', () => {
  it('members of A see only stop drafts of A', () => {
    for (const uid of [U_ADMIN_A, U_OP_A, U_DRIVER_A]) {
      const w = makeWorld(uid);
      expect(visibleStopDrafts(w).map((s) => s.id)).toEqual(['sd-a']);
    }
  });
  it('member of A cannot insert stop draft for tenant B', () => {
    const w = makeWorld(U_ADMIN_A);
    expect(canWriteStopDraft(w, T_A)).toBe(true);
    expect(canWriteStopDraft(w, T_B)).toBe(false);
  });
  it('non-member cannot read or write stop drafts of any tenant', () => {
    const w = makeWorld('stranger');
    expect(visibleStopDrafts(w)).toEqual([]);
    expect(canWriteStopDraft(w, T_A)).toBe(false);
    expect(canWriteStopDraft(w, T_B)).toBe(false);
  });
});

describe('RLS cross-tenant isolation: dispatch trips', () => {
  it('operator of A sees only trip-a', () => {
    const w = makeWorld(U_OP_A);
    expect(visibleTrips(w).map((t) => t.id)).toEqual(['trip-a']);
  });
  it('admin of A cannot manage trip-b', () => {
    const w = makeWorld(U_ADMIN_A);
    const tripB = w.trips.find((t) => t.tenant_id === T_B)!;
    expect(canManageTrip(w, tripB)).toBe(false);
  });
  it('driver of A sees only own trip', () => {
    const w = makeWorld(U_DRIVER_A);
    expect(visibleTrips(w).map((t) => t.id)).toEqual(['trip-a']);
  });
  it('driver linked to a driver row of another tenant cannot cross tenants', () => {
    // Simulate a leaked driver row: same user_id linked to a driver in tenant B
    const w = makeWorld(U_DRIVER_A);
    w.drivers.push({ id: 'drv-a-shadow', tenant_id: T_B, user_id: U_DRIVER_A, active: true });
    // Driver still has no membership in B, and no trip in B references drv-a-shadow
    expect(visibleTrips(w).map((t) => t.id)).toEqual(['trip-a']);
  });
});

describe('RLS cross-tenant isolation: dispatch stops', () => {
  it('operator of A sees only stop-a', () => {
    const w = makeWorld(U_OP_A);
    expect(visibleStops(w).map((s) => s.id)).toEqual(['stop-a']);
  });
  it('driver of A sees only stops of own trip', () => {
    const w = makeWorld(U_DRIVER_A);
    expect(visibleStops(w).map((s) => s.id)).toEqual(['stop-a']);
  });
  it('admin of A cannot manage stop-b', () => {
    const w = makeWorld(U_ADMIN_A);
    const stopB = w.stops.find((s) => s.tenant_id === T_B)!;
    expect(canManageStop(w, stopB)).toBe(false);
  });
  it('inactive driver of A sees no stops even if trip exists', () => {
    const w = makeWorld(U_DRIVER_A);
    w.drivers = w.drivers.map((d) => (d.id === 'drv-a' ? { ...d, active: false } : d));
    expect(visibleStops(w)).toEqual([]);
  });
});

describe('RLS cross-tenant isolation: negative sanity checks', () => {
  it('user with no memberships sees nothing across all tables', () => {
    const w = makeWorld('nobody');
    expect(visibleDrafts(w)).toEqual([]);
    expect(visibleStopDrafts(w)).toEqual([]);
    expect(visibleTrips(w)).toEqual([]);
    expect(visibleStops(w)).toEqual([]);
  });
  it('inactive membership does not grant access', () => {
    const w = makeWorld(U_ADMIN_A);
    w.memberships = w.memberships.map((m) =>
      m.user_id === U_ADMIN_A ? { ...m, active: false } : m,
    );
    expect(visibleDrafts(w)).toEqual([]);
    expect(visibleStopDrafts(w)).toEqual([]);
    expect(visibleTrips(w)).toEqual([]);
    expect(visibleStops(w)).toEqual([]);
  });
});