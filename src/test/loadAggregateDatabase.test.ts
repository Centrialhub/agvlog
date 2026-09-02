// @vitest-environment node
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applyLoadCommand, atomicLoadForeignKeyIndexSql, atomicLoadNumberSql, createLoadAggregateDatabase,
  loadAggregateIds as i, loadAggregateSql, loadCommand, seedLoad,
} from './helpers/loadAggregateDatabase';

let db: PGlite;
beforeAll(async () => { db = await createLoadAggregateDatabase(); }, 40_000);
beforeEach(async () => {
  await db.exec('begin');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [i.operator]);
});
afterEach(async () => { await db.exec('rollback;reset role'); });
afterAll(async () => { await db?.close(); });

describe('atomic operator load aggregate commands', () => {
  it('allocates a canonical number on the server and exactly replays concurrent create', async () => {
    expect((await db.query(`select
      to_regprocedure('public.digest(bytea,text)') is null public_digest_absent,
      to_regprocedure('extensions.digest(bytea,text)') is not null extensions_digest_available`)).rows[0])
      .toEqual({ public_digest_absent: true, extensions_digest_available: true });
    const payload = loadCommand('create', { changes: { destination: 'Cliente QA' } });
    const [first, replay] = await Promise.all([applyLoadCommand(db, payload), applyLoadCommand(db, payload)]);
    expect(first).toMatchObject({ ok: true, action: 'create', version: 1, replayed: false });
    expect(replay).toMatchObject({ ok: true, action: 'create', load_id: first.load_id, replayed: true });
    const row = (await db.query<Record<string, unknown>>(
      'select load_number,status,trip_id,total_weight_kg,total_volume_m3,total_pallet_count,version from public.loads where id=$1',
      [first.load_id],
    )).rows[0];
    expect(row).toEqual({
      load_number: '1001', status: 'planned', trip_id: null,
      total_weight_kg: '0', total_volume_m3: '0', total_pallet_count: 0, version: 1,
    });
    expect((await db.query('select count(*)::int n from private.load_aggregate_commands')).rows[0]).toEqual({ n: 1 });
    await expect(applyLoadCommand(db, { ...payload, changes: { destination: 'Outro cliente' } }))
      .rejects.toThrow('request_payload_mismatch');
  });

  it('reapplies without replacing validated tenant FKs or the final-row revision trigger', async () => {
    const catalog = async () => (await db.query(`select
      (select jsonb_object_agg(conname,oid::text) from pg_constraint
        where conrelid='public.loads'::regclass
          and conname in('loads_tenant_driver_fkey','loads_tenant_vehicle_fkey','loads_tenant_trip_fkey')) constraints,
      (select oid::text from pg_trigger where tgrelid='public.loads'::regclass
        and tgname='trg_zz_bump_load_revision' and not tgisinternal) revision_trigger`)).rows[0];
    const before = await catalog();
    await db.exec(loadAggregateSql());
    await db.exec(atomicLoadNumberSql());
    await db.exec(atomicLoadForeignKeyIndexSql());
    expect(await catalog()).toEqual(before);
    expect((await db.query(`select
      to_regprocedure('public.apply_load_aggregate_command(jsonb)') is not null writer,
      to_regprocedure('public.get_next_load_number_v1(uuid)') is null legacy_retired`)).rows[0])
      .toEqual({ writer: true, legacy_retired: true });
  });

  it('covers every new foreign key with an index whose leading keys match the constraint', async () => {
    const indexes = (await db.query<{ index_name: string; keys: string }>(`
      select index_class.relname index_name,
             string_agg(attribute.attname, ',' order by key.ordinality) keys
      from pg_index index_catalog
      join pg_class index_class on index_class.oid = index_catalog.indexrelid
      join lateral unnest(index_catalog.indkey::smallint[]) with ordinality key(attnum, ordinality)
        on key.ordinality <= index_catalog.indnkeyatts
      join pg_attribute attribute
        on attribute.attrelid = index_catalog.indrelid and attribute.attnum = key.attnum
      where index_class.relname in (
        'idx_load_aggregate_commands_actor_id',
        'idx_loads_tenant_driver',
        'idx_loads_tenant_vehicle',
        'idx_loads_tenant_trip'
      )
      group by index_class.relname
      order by index_class.relname
    `)).rows;

    expect(indexes).toEqual([
      { index_name: 'idx_load_aggregate_commands_actor_id', keys: 'actor_id' },
      { index_name: 'idx_loads_tenant_driver', keys: 'tenant_id,driver_id' },
      { index_name: 'idx_loads_tenant_trip', keys: 'tenant_id,trip_id' },
      { index_name: 'idx_loads_tenant_vehicle', keys: 'tenant_id,vehicle_id' },
    ]);
  });

  it('increments the revision after an earlier trigger autofills the final driver', async () => {
    await db.query(`insert into public.loads(id,tenant_id,load_number,vehicle_id,status,version)
      values($1,$2,'1001',$3,'planned',1)`, [i.load, i.tenant, i.vehicle]);
    await db.query('update public.vehicles set current_driver_id=$1 where id=$2', [i.driver, i.vehicle]);
    await db.query('update public.loads set vehicle_id=vehicle_id where id=$1', [i.load]);
    expect((await db.query('select driver_id,version from public.loads where id=$1', [i.load])).rows[0])
      .toEqual({ driver_id: i.driver, version: 2 });
  });

  it('fails closed instead of replacing a drifted named tenant constraint', async () => {
    await db.exec(`savepoint tenant_fk_drift;
      alter table public.loads drop constraint loads_tenant_driver_fkey;
      alter table public.loads add constraint loads_tenant_driver_fkey
        foreign key(driver_id) references public.drivers(id);`);
    await expect(db.exec(loadAggregateSql()))
      .rejects.toThrow('loads_tenant_driver_fkey exists with an incompatible definition');
    await db.exec('rollback to savepoint tenant_fk_drift;release savepoint tenant_fk_drift');
  });

  it('does not retire the legacy reader when the canonical writer ACL drifts', async () => {
    await db.exec(`create function public.get_next_load_number_v1(uuid) returns text language sql as
      $$select '1001'::text$$;
      savepoint writer_acl_drift;
      grant execute on function public.apply_load_aggregate_command(jsonb) to anon;`);
    await expect(db.exec(atomicLoadNumberSql()))
      .rejects.toThrow('does not have the expected browser-only ACL');
    await db.exec('rollback to savepoint writer_acl_drift;release savepoint writer_acl_drift');
    expect((await db.query(`select
      to_regprocedure('public.get_next_load_number_v1(uuid)') is not null legacy_preserved`)).rows[0])
      .toEqual({ legacy_preserved: true });
  });

  it('allocates after more than 10,000 loads without considering another tenant', async () => {
    await db.query(`insert into public.loads(tenant_id,load_number,status)
      select $1, n::text, 'planned' from generate_series(1001,11050) n`, [i.tenant]);
    await db.query(`insert into public.loads(tenant_id,load_number,status)
      values($1,'999999','planned')`, [i.otherTenant]);

    const result = await applyLoadCommand(db, loadCommand('create', {
      changes: { destination: 'Volume QA' },
    }));

    expect(result).toMatchObject({
      ok: true, action: 'create', replayed: false, load: { load_number: '11051' },
    });
    expect((await db.query('select load_number from public.loads where id=$1', [result.load_id])).rows[0])
      .toEqual({ load_number: '11051' });
  }, 20_000);

  it('serializes distinct concurrent creates into unique tenant-scoped numbers', async () => {
    const [first, second] = await Promise.all([
      applyLoadCommand(db, loadCommand('create', { changes: { destination: 'Concorrente A' } })),
      applyLoadCommand(db, loadCommand('create', { changes: { destination: 'Concorrente B' } })),
    ]);
    const numbers = [first, second]
      .map(result => String((result.load as Record<string, unknown>)?.load_number ?? ''))
      .sort();
    expect(numbers).toEqual(['1001', '1002']);
    expect((await db.query(`select count(*)::int n, count(distinct load_number)::int distinct_n
      from public.loads where tenant_id=$1`, [i.tenant])).rows[0])
      .toEqual({ n: 2, distinct_n: 2 });
  });

  it('updates only header fields with expected version and rejects forged totals atomically', async () => {
    await seedLoad(db);
    const updated = await applyLoadCommand(db, loadCommand('update', {
      load_id: i.load, expected_version: 1,
      changes: { notes: 'Cabeçalho revisado', vehicle_id: i.vehicle },
      reason: 'Ajuste operacional QA',
    }));
    expect(updated).toMatchObject({ ok: true, action: 'update', load_id: i.load, version: 2 });
    await db.exec('savepoint forged_totals');
    await expect(applyLoadCommand(db, loadCommand('update', {
      load_id: i.load, expected_version: 2,
      changes: { notes: 'Não deve persistir', total_weight_kg: 999_999 },
    }))).rejects.toThrow('unsupported_load_fields');
    await db.exec('rollback to savepoint forged_totals;release savepoint forged_totals');
    expect((await db.query('select notes,total_weight_kg,status,trip_id,version from public.loads where id=$1', [i.load])).rows[0])
      .toEqual({ notes: 'Cabeçalho revisado', total_weight_kg: '0', status: 'planned', trip_id: null, version: 2 });
  });

  it('fails closed for a stale revision and cross-tenant resources', async () => {
    await seedLoad(db);
    await db.exec('savepoint stale_revision');
    await expect(applyLoadCommand(db, loadCommand('update', {
      load_id: i.load, expected_version: 9, changes: { notes: 'stale' },
    }))).rejects.toThrow(/load_revision_conflict|load_concurrent_change/);
    await db.exec('rollback to savepoint stale_revision;release savepoint stale_revision');
    expect((await db.query('select notes,version from public.loads where id=$1', [i.load])).rows[0])
      .toEqual({ notes: null, version: 1 });
  });

  it('rejects cross-tenant resources without changing the load', async () => {
    await seedLoad(db);
    await db.exec('savepoint foreign_resource');
    await expect(applyLoadCommand(db, loadCommand('update', {
      load_id: i.load, expected_version: 1, changes: { driver_id: i.otherDriver },
    }))).rejects.toThrow('driver_not_available_for_tenant');
    await db.exec('rollback to savepoint foreign_resource;release savepoint foreign_resource');
    expect((await db.query('select driver_id,version from public.loads where id=$1', [i.load])).rows[0])
      .toEqual({ driver_id: null, version: 1 });
    await expect(db.query('update public.loads set vehicle_id=$1 where id=$2', [i.otherVehicle, i.load]))
      .rejects.toThrow(/loads_tenant_vehicle_fkey|foreign key/i);
  });

  it('requires replanning before changing resources of an active trip', async () => {
    await seedLoad(db);
    await db.query("insert into public.dispatch_trips(id,tenant_id,status,load_id) values($1,$2,'planned',$3)", [i.trip, i.tenant, i.load]);
    await db.exec('savepoint active_trip');
    await expect(applyLoadCommand(db, loadCommand('update', {
      load_id: i.load, expected_version: 1, changes: { destination: 'Nova rota' },
    }))).rejects.toThrow('active_trip_requires_replanning');
    await db.exec('rollback to savepoint active_trip;release savepoint active_trip');
    expect((await db.query('select destination,version from public.loads where id=$1', [i.load])).rows[0])
      .toEqual({ destination: 'Destino QA', version: 1 });
  });

  it('makes hold and unhold recoverable without duplicating history or revisions', async () => {
    await seedLoad(db);
    const hold = loadCommand('hold', {
      load_id: i.load, expected_version: 1, reason: 'Aguardando liberação do cliente',
    });
    const first = await applyLoadCommand(db, hold);
    const replay = await applyLoadCommand(db, hold);
    expect(first).toMatchObject({ version: 2, replayed: false });
    expect(replay).toMatchObject({ version: 2, replayed: true });
    expect((await db.query('select count(*)::int n from public.load_status_history where load_id=$1', [i.load])).rows[0])
      .toEqual({ n: 1 });
    const released = await applyLoadCommand(db, loadCommand('unhold', {
      load_id: i.load, expected_version: 2,
    }));
    expect(released).toMatchObject({ version: 3, replayed: false });
    expect((await db.query('select on_hold,hold_reason,held_at,held_by,version from public.loads where id=$1', [i.load])).rows[0])
      .toEqual({ on_hold: false, hold_reason: null, held_at: null, held_by: null, version: 3 });
  });

  it('rolls back the whole command when durable ledger persistence fails late', async () => {
    await seedLoad(db);
    await db.exec(`create function private.qa_fail_load_command() returns trigger language plpgsql as $$begin
      raise exception 'qa_late_failure';end$$;
      create trigger qa_fail_load_command before insert on private.load_aggregate_commands
      for each row execute function private.qa_fail_load_command();savepoint late_failure;`);
    await expect(applyLoadCommand(db, loadCommand('update', {
      load_id: i.load, expected_version: 1, changes: { notes: 'Não pode persistir' },
    }))).rejects.toThrow('qa_late_failure');
    await db.exec('rollback to savepoint late_failure;release savepoint late_failure');
    expect((await db.query('select notes,version from public.loads where id=$1', [i.load])).rows[0])
      .toEqual({ notes: null, version: 1 });
  });

  it('blocks financial evidence and makes delete_many all-or-nothing', async () => {
    await seedLoad(db); await seedLoad(db, i.load2, '1002');
    await db.query('insert into public.load_payments(load_id) values($1)', [i.load2]);
    await db.exec('savepoint batch_delete');
    await expect(applyLoadCommand(db, loadCommand('delete_many', {
      targets: [
        { load_id: i.load, expected_version: 1 },
        { load_id: i.load2, expected_version: 1 },
      ],
      reason: 'Limpeza integral de cargas de teste',
    }))).rejects.toThrow('load_delete_has_dependencies');
    await db.exec('rollback to savepoint batch_delete;release savepoint batch_delete');
    expect((await db.query('select count(*)::int n from public.loads where id in($1,$2)', [i.load, i.load2])).rows[0])
      .toEqual({ n: 2 });
    await db.query('delete from public.load_payments where load_id=$1', [i.load2]);
    const deleted = await applyLoadCommand(db, loadCommand('delete_many', {
      targets: [
        { load_id: i.load, expected_version: 1 },
        { load_id: i.load2, expected_version: 1 },
      ],
      reason: 'Limpeza integral de cargas de teste',
    }));
    expect(deleted).toMatchObject({ action: 'delete_many', replayed: false });
    expect((deleted.deleted_load_ids as string[]).sort()).toEqual([i.load, i.load2].sort());
    expect((await db.query('select count(*)::int n from public.loads where id in($1,$2)', [i.load, i.load2])).rows[0])
      .toEqual({ n: 0 });
    expect((await db.query("select count(*)::int n from public.entity_audit_log where action='delete'")).rows[0])
      .toEqual({ n: 2 });
  });

  it('revalidates membership before replay and exposes only the canonical API', async () => {
    await seedLoad(db);
    const payload = loadCommand('update', {
      load_id: i.load, expected_version: 1, changes: { notes: 'Primeira execução' },
    });
    await applyLoadCommand(db, payload);
    await db.query('update public.tenant_memberships set active=false where tenant_id=$1 and user_id=$2', [i.tenant, i.operator]);
    await db.exec('savepoint inactive_replay');
    await expect(applyLoadCommand(db, payload)).rejects.toThrow('operator_role_required');
    await db.exec('rollback to savepoint inactive_replay;release savepoint inactive_replay');
    const acl = (await db.query<Record<string, boolean>>(`select
      has_function_privilege('authenticated','public.apply_load_aggregate_command(jsonb)','execute') api,
      has_function_privilege('anon','public.apply_load_aggregate_command(jsonb)','execute') anon_api,
      has_function_privilege('authenticated','private.insert_load_from_json(jsonb)','execute') helper,
      has_table_privilege('authenticated','private.load_aggregate_commands','select') ledger,
      to_regprocedure('public.get_next_load_number_v1(uuid)') is null legacy_preview_retired`)).rows[0];
    expect(acl).toEqual({
      api: true, anon_api: false, helper: false, ledger: false, legacy_preview_retired: true,
    });
    const definition = (await db.query<{ definition: string }>(`select pg_get_functiondef(
      'public.apply_load_aggregate_command(jsonb)'::regprocedure) definition`)).rows[0].definition;
    expect(definition).toMatch(/SET search_path TO '?pg_catalog'?, '?public'?, '?private'?/);
  });

  it('rejects a request from another tenant without leaking whether a load exists', async () => {
    await seedLoad(db);
    const payload = {
      schema_version: 1, tenant_id: i.otherTenant, request_id: randomUUID(), action: 'update',
      load_id: i.load, expected_version: 1, changes: { notes: 'tentativa externa' },
    };
    await expect(applyLoadCommand(db, payload)).rejects.toMatchObject({ code: '42501' });
  });
});
