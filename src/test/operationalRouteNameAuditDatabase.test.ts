// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { request } from './helpers/assignedIncidentPersonnelFixture';
import {
  actualFunction, auditRows, catalog, createRouteNameAuditDatabase, forward, ids,
  nextRevision, rename, rollback, routeId, routeSnapshot,
} from './helpers/operationalRouteNameAuditDatabase';

let db: PGlite;
beforeEach(async () => { db = await createRouteNameAuditDatabase(); });
afterEach(async () => { if (db) await db.close(); });

describe('actual predecessor and guarded incremental correction', () => {
  it('reproduces42703 and preserves the entire row and empty audit log', async () => {
    const before = await routeSnapshot(db);
    await expect(rename(db)).rejects.toMatchObject({ code: '42703' });
    expect(await routeSnapshot(db)).toEqual(before);
    expect(await auditRows(db)).toEqual([]);
    await db.exec(forward);
    expect((await rename(db)).rows).toHaveLength(1);
    expect(await auditRows(db)).toHaveLength(1);
  });

  it('refuses an unknown predecessor before changing namespace or metadata', async () => {
    await db.exec(actualFunction('operational_routes_audit_name').replace('RETURN NEW;', 'RETURN OLD;'));
    const before = await catalog(db);
    await expect(db.exec(forward)).rejects.toMatchObject({ code: '55000' });
    expect(await catalog(db)).toEqual(before);
  });

  it('refuses destination collision rather than replacing another function', async () => {
    await db.exec("create function private.operational_routes_audit_name() returns trigger language plpgsql as $$begin return new;end$$;");
    await expect(db.exec(forward)).rejects.toMatchObject({ code: '55000' });
    expect((await db.query<{ present: boolean }>("select to_regprocedure('public.operational_routes_audit_name()') is not null present")).rows[0].present).toBe(true);
  });

  it('refuses changed writer, log shape, binding or client execution privileges', async () => {
    const variants = [
      "alter function public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text) security invoker",
      'alter table public.entity_audit_log add column changes jsonb',
      'alter table public.operational_routes disable trigger trg_operational_routes_audit_name',
      'grant execute on function public.operational_routes_audit_name() to authenticated',
    ];
    for (const variant of variants) {
      await db.exec('begin');
      try {
        await db.exec(variant);
        await expect(db.exec(forward)).rejects.toMatchObject({ code: '55000' });
      } finally { await db.exec('rollback'); }
    }
    expect((await db.query<{ present: boolean }>("select to_regprocedure('private.operational_routes_audit_name()') is not null present")).rows[0].present).toBe(false);
  });
});

describe('corrected actual trigger with captured native auth/context helpers', () => {
  beforeEach(async () => { await db.exec(forward); });

  it('stores one name audit with actor derived on server, not updated_by supplied by caller', async () => {
    expect((await rename(db, 'Rota corrigida', { actorToStore: ids.operator })).rows[0].name).toBe('Rota corrigida');
    expect(await auditRows(db)).toEqual([{
      tenant_id: ids.tenant, entity_type: 'operational_route', entity_id: routeId, action: 'rename',
      old_data: { name: 'Rota inicial' }, new_data: { name: 'Rota corrigida' },
      actor_user_id: ids.admin, actor_role: 'admin', source: 'operational_routes_audit_name', request_id: null,
    }]);
    expect((await routeSnapshot(db)).description).toBe('Preservar descricao');
  });

  it('allows an owner without changing route write policies', async () => {
    await db.query("update tenant_memberships set role='owner' where tenant_id=$1 and user_id=$2", [ids.tenant, ids.admin]);
    expect((await rename(db)).rows).toHaveLength(1);
    expect((await auditRows(db))[0].actor_role).toBe('owner');
  });

  it('preserves compare-and-swap: second request with old revision returns zero rows', async () => {
    expect((await rename(db)).rows).toHaveLength(1);
    const before = await routeSnapshot(db);
    expect((await rename(db, 'Tentativa obsoleta')).rows).toEqual([]);
    expect(await routeSnapshot(db)).toEqual(before);
    expect(await auditRows(db)).toHaveLength(1);
    expect((await rename(db, 'Proxima revisao', { expected: nextRevision, next: '2026-01-03T00:00:00Z' })).rows).toHaveLength(1);
    expect(await auditRows(db)).toHaveLength(2);
  });

  it('leaves no audit when name is unchanged or blank guard retains old name', async () => {
    expect((await rename(db, 'Rota inicial')).rows).toHaveLength(1);
    expect((await rename(db, '   ', { expected: nextRevision, next: '2026-01-03T00:00:00Z' })).rows[0].name).toBe('Rota inicial');
    expect(await auditRows(db)).toEqual([]);
  });

  it('preserves normalized name uniqueness and atomic rollback', async () => {
    const before = await routeSnapshot(db);
    await expect(rename(db, 'Outra rota')).rejects.toMatchObject({ code: '23505' });
    expect(await routeSnapshot(db)).toEqual(before);
    expect(await auditRows(db)).toEqual([]);
  });

  it.each([ids.operator, ids.assigned, ids.client, ids.foreign, null])('does not broaden baseline updates for actor%s', async actor => {
    const before = await routeSnapshot(db);
    expect((await rename(db, 'Sem permissao', { actor })).rows).toEqual([]);
    expect(await routeSnapshot(db)).toEqual(before);
    expect(await auditRows(db)).toEqual([]);
  });

  it('denies inactive membership and unauthenticated access', async () => {
    await db.query('update tenant_memberships set active=false where tenant_id=$1 and user_id=$2', [ids.tenant, ids.admin]);
    expect((await rename(db)).rows).toEqual([]);
    await expect(rename(db, 'Anonimo', { actor: null, role: 'anon' })).rejects.toMatchObject({ code: '42501' });
    expect(await auditRows(db)).toEqual([]);
  });

  it('denies mismatched request tenant even for an admin who belongs to both tenants', async () => {
    await db.query("insert into tenant_memberships values($1,$2,'admin',true)", [ids.otherTenant, ids.admin]);
    const before = await routeSnapshot(db);
    await expect(rename(db, 'Contexto incorreto', { requestTenant: ids.otherTenant, workspace: ids.otherWorkspace })).rejects.toMatchObject({ code: '42501' });
    expect(await routeSnapshot(db)).toEqual(before);
    expect(await auditRows(db)).toEqual([]);
  });

  it('keeps closed writer/direct INSERT and private trigger unavailable to clients', async () => {
    for (const sql of [
      "select public._log_entity_audit($1,'operational_route',$2,'rename',null,null,'forged')",
      "select private.operational_routes_audit_name()",
      "insert into entity_audit_log(tenant_id,entity_type,entity_id,action) values($1,'operational_route',$2,'rename')",
    ]) {
      const params = sql.includes('$1') ? [ids.tenant, routeId] : [];
      await expect(request(db, ids.admin, sql, params)).rejects.toMatchObject({ code: '42501' });
    }
    expect(await auditRows(db)).toEqual([]);
  });

  it('rolls back the entire update when the audit sink fails', async () => {
    const failSql = actualFunction('_log_entity_audit').replace(/\$function\$[\s\S]*?\$function\$/, () => "$function$BEGIN RAISE EXCEPTION 'audit_sink_unavailable'; END;$function$");
    await db.exec(failSql);
    const before = await routeSnapshot(db);
    await expect(rename(db)).rejects.toThrow('audit_sink_unavailable');
    expect(await routeSnapshot(db)).toEqual(before);
    expect(await auditRows(db)).toEqual([]);
  });

  it('denies a service-role rename without an actor but allows a no-op name update', async () => {
    await db.exec('set role service_role');
    try {
      await expect(db.query('update operational_routes set name=$1 where id=$2', ['No actor', routeId])).rejects.toMatchObject({ code: '42501' });
      expect((await db.query('update operational_routes set name=name where id=$1 returning id', [routeId])).rows).toHaveLength(1);
    } finally { await db.exec('reset role'); }
    expect(await auditRows(db)).toEqual([]);
  });
});

describe('catalog preservation, idempotence and guarded rollback', () => {
  it('changes only namespace/body/security/search_path while preserving OID, ACL, trigger and data controls', async () => {
    const before = await catalog(db);
    await db.exec(forward);
    const after = await catalog(db);
    const allowed = new Set(['pronamespace', 'prosrc', 'prosecdef', 'proconfig']);
    const unchanged = (record: Record<string, unknown>) => Object.fromEntries(Object.entries(record).filter(([key]) => !allowed.has(key)));
    expect(unchanged(after.fn)).toEqual(unchanged(before.fn));
    expect(after.fn.prosecdef).toBe(true);
    expect(after.fn.proconfig).toEqual(['search_path=""']);
    expect(after.trigger).toEqual(before.trigger);
    expect(after.stable).toEqual(before.stable);
    await db.exec(forward);
    expect(await catalog(db)).toEqual(after);
    await rename(db);
    const logs = await auditRows(db);
    await db.exec(rollback);
    expect(await catalog(db)).toEqual(before);
    expect(await auditRows(db)).toEqual(logs);
    await db.exec(rollback);
    const row = await routeSnapshot(db);
    await expect(rename(db, 'Depois do rollback', { expected: nextRevision })).rejects.toMatchObject({ code: '42703' });
    expect(await routeSnapshot(db)).toEqual(row);
    await db.exec(forward);
    expect((await rename(db, 'Reaplicada', { expected: nextRevision })).rows).toHaveLength(1);
    expect(await auditRows(db)).toHaveLength(2);
  });

  it('refuses rollback after an unknown successor change', async () => {
    await db.exec(forward);
    await db.exec('alter function private.operational_routes_audit_name() set search_path=public');
    const before = await catalog(db);
    await expect(db.exec(rollback)).rejects.toMatchObject({ code: '55000' });
    expect(await catalog(db)).toEqual(before);
  });
});
