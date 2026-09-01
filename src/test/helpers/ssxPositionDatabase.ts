import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const baseline = readFileSync('supabase/migrations/20260824224152_baseline.sql', 'utf8');
export const ssxPositionMigration = '20260831211632_make_ssx_position_ingestion_monotonic.sql';
export const ssxPositionSql = () => readFileSync('supabase/migrations/' + ssxPositionMigration, 'utf8');

export const ssxIds = {
  tenant: '21000000-0000-4000-8000-000000000001',
  otherTenant: '21000000-0000-4000-8000-000000000002',
  account: '22000000-0000-4000-8000-000000000001',
  unit: '23000000-0000-4000-8000-000000000001',
  link: '24000000-0000-4000-8000-000000000001',
  vehicle: '25000000-0000-4000-8000-000000000001',
  otherLink: '24000000-0000-4000-8000-000000000002',
  otherVehicle: '25000000-0000-4000-8000-000000000002',
};

const tables = [
  'tenants',
  'vehicles',
  'integration_accounts',
  'provider_units',
  'vehicle_tracker_links',
  'tenant_feature_policy',
  'positions_raw',
  'positions_last',
  'ingestion_cursors',
  'vehicle_processing_queue',
];

export async function ssxPositionDatabase() {
  const db = new PGlite();
  try {
    await prepareSsxPositionDatabase(db);
    await seedSsxPosition(db);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

export async function prepareSsxPositionDatabase(
  db: Pick<PGlite, 'exec'>,
  createRoles = true,
) {
  if (createRoles) await db.exec('create role anon;create role authenticated;create role service_role;');
  for (const name of tables) {
    const ddl = baseline.match(new RegExp('CREATE TABLE public\\.' + name + ' \\([\\s\\S]*?\\n\\);'))?.[0];
    if (!ddl) throw new Error('Missing SSX table ' + name);
    await db.exec(ddl);
    for (const sql of baseline.match(new RegExp(
      'ALTER TABLE ONLY public\\.' + name + '\\s+ALTER COLUMN[\\s\\S]*?;', 'g',
    )) ?? []) await db.exec(sql);
    for (const sql of baseline.match(new RegExp(
      'ALTER TABLE ONLY public\\.' + name + '\\s+ADD CONSTRAINT[\\s\\S]*?;', 'g',
    )) ?? []) {
      if (/PRIMARY KEY|UNIQUE /.test(sql) && !/FOREIGN KEY/.test(sql)) await db.exec(sql);
    }
  }
  await db.exec(
    'grant select,insert,update,delete on table ' +
    tables.map((name) => 'public.' + name).join(',') +
    ' to service_role;',
  );
  await db.exec(ssxPositionSql());
}

export async function seedSsxPosition(db: Pick<PGlite, 'query'>) {
  const i = ssxIds;
  await db.query(
    `insert into tenants(id,name) values($1,'Tenant QA'),($2,'Outro Tenant QA')`,
    [i.tenant, i.otherTenant],
  );
  await db.query(
    `insert into vehicles(id,tenant_id,plate) values($1,$2,'QA-1000'),($3,$4,'QA-2000')`,
    [i.vehicle, i.tenant, i.otherVehicle, i.otherTenant],
  );
  await db.query(
    `insert into integration_accounts(
       id,tenant_id,provider,base_url,username,password_encrypted,status
     ) values($1,$2,'SSX','https://ssx.invalid','qa','enc:v1:qa','ok')`,
    [i.account, i.tenant],
  );
  await db.query(
    `insert into provider_units(
       id,tenant_id,integration_account_id,external_code,active
     ) values($1,$2,$3,'UNIT-QA',true)`,
    [i.unit, i.tenant, i.account],
  );
  await db.query(
    `insert into vehicle_tracker_links(
       id,tenant_id,vehicle_id,provider_unit_id,active,start_at
     ) values($1,$2,$3,$4,true,now()-interval '1 day')`,
    [i.link, i.tenant, i.vehicle, i.unit],
  );
  await db.query(
    `insert into tenant_feature_policy(tenant_id,feature_key,enabled)
     values($1,'ssx_enabled',true),($1,'ssx_kill_switch',false)`,
    [i.tenant],
  );
}

export type SsxPosition = {
  captured_at: string;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  telemetry: Record<string, unknown>;
  provider_payload_hash: string;
};

export async function commitSsx(
  db: PGlite,
  positions: SsxPosition[],
  options: {
    receivedAt?: string;
    link?: string;
    vehicle?: string;
    memo?: Record<string, unknown>;
  } = {},
) {
  const i = ssxIds;
  await db.exec('set role service_role');
  try {
    const result = await db.query<{ result: Record<string, unknown> }>(
      `select public.commit_ssx_position_batch_v1(
        $1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb
      ) result`,
      [
        i.tenant, i.account, i.unit, options.link ?? i.link,
        options.vehicle ?? i.vehicle, options.receivedAt ?? new Date().toISOString(),
        JSON.stringify(positions), JSON.stringify(options.memo ?? { combo_source: 'qa' }),
      ],
    );
    return result.rows[0].result;
  } finally {
    await db.exec('reset role').catch(() => { /* transaction may be aborted */ });
  }
}

export async function recordSsxError(
  db: PGlite,
  observedAt: string,
  error = 'provider_error',
  backoffUntil = new Date(new Date(observedAt).getTime() + 60_000).toISOString(),
  pollMemo: Record<string, unknown> = { error_marker: observedAt },
) {
  const i = ssxIds;
  await db.exec('set role service_role');
  try {
    const result = await db.query<{ result: Record<string, unknown> }>(
      `select public.record_ssx_poll_error_v1(
        $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb
      ) result`,
      [i.tenant, i.account, i.unit, i.link, i.vehicle, observedAt, error,
        backoffUntil, JSON.stringify(pollMemo)],
    );
    return result.rows[0].result;
  } finally {
    await db.exec('reset role').catch(() => {});
  }
}
