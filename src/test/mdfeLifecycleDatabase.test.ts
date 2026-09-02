// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ids = {
  tenant: '10000000-0000-4000-8000-000000000001',
  actor: '10000000-0000-4000-8000-000000000002',
  load: '10000000-0000-4000-8000-000000000003',
  driver: '10000000-0000-4000-8000-000000000004',
  vehicle: '10000000-0000-4000-8000-000000000005',
  emitter: '10000000-0000-4000-8000-000000000006',
  cte: '10000000-0000-4000-8000-000000000007',
  emission: '10000000-0000-4000-8000-000000000008',
};

const snapshot = {
  emitterCnpj: '18666510000168',
  environment: 'production',
  payload: {
    modalidadeDeTransporte: '1',
    produtoPredominante: { descricao: 'FARINHA DE TRIGO' },
    infModal: { rodo: { condutor: [{ CPF: '06315576605' }], veicTracao: { placa: 'GVJ3744' } } },
  },
};

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.tenants(id uuid primary key);
    create table public.tenant_memberships(tenant_id uuid,user_id uuid,active boolean,role text);
    create table public.tenant_emitters(id uuid primary key,tenant_id uuid,active boolean);
    create table public.drivers(id uuid primary key,tenant_id uuid,active boolean,cpf text);
    create table public.vehicles(id uuid primary key,tenant_id uuid,active boolean,plate text);
    create table public.loads(
      id uuid primary key,tenant_id uuid,status text,driver_id uuid,vehicle_id uuid,
      load_number text,origin text,destination text,arrival_at timestamptz
    );
    create table public.cte_documents(
      id uuid primary key,tenant_id uuid,is_voided boolean,load_ids uuid[],
      sefaz_status text,status text,access_key text
    );
    create table public.load_manifests(
      id uuid primary key,tenant_id uuid,load_id uuid,manifest_number text,
      fiscal_document_ids uuid[] not null,cte_document_ids uuid[] not null,status text,
      created_by uuid,origin text,destination text,
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp()
    );
    create table public.hub_fiscal_emissions(
      id uuid primary key,tenant_id uuid,doc_type text,environment text,status text,
      dispatch_state text,hub_document_id text,access_key text,authorization_protocol text,
      number text,series text,message text,pdf_url text,xml_url text,
      last_response jsonb,last_callback jsonb,created_at timestamptz default clock_timestamp()
    );
    create function public.claim_hub_fiscal_emission(uuid,uuid,uuid,text,text,jsonb,uuid,uuid,uuid)
      returns jsonb language sql as $$select '{}'::jsonb$$;
  `);
  const migration = readFileSync(
    'supabase/migrations/20260901181949_production_mdfe_load_lifecycle.sql',
    'utf8',
  );
  await db.exec(migration);
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', ids.actor]);
  await db.query('insert into tenants values($1)', [ids.tenant]);
  await db.query("insert into tenant_memberships values($1,$2,true,'operator')", [ids.tenant, ids.actor]);
  await db.query('insert into tenant_emitters values($1,$2,true)', [ids.emitter, ids.tenant]);
  await db.query("insert into drivers values($1,$2,true,'06315576605')", [ids.driver, ids.tenant]);
  await db.query("insert into vehicles values($1,$2,true,'GVJ3744')", [ids.vehicle, ids.tenant]);
  await db.query(
    "insert into loads values($1,$2,'loaded',$3,$4,'CG-001','MONTES CLAROS','MANGA',null)",
    [ids.load, ids.tenant, ids.driver, ids.vehicle],
  );
  await db.query(
    "insert into cte_documents values($1,$2,false,array[$3]::uuid[],'authorized','authorized',$4)",
    [ids.cte, ids.tenant, ids.load, '3'.repeat(44)],
  );
}, 30_000);

afterAll(async () => db?.close());

async function prepare() {
  await db.exec('begin; set local role authenticated');
  try {
    const result = await db.query<{ result: Record<string, unknown> }>(
      'select prepare_mdfe_issue($1,$2,$3,$4,array[$5]::uuid[],$6::jsonb) result',
      [ids.tenant, ids.load, ids.emitter, 'production', ids.cte, JSON.stringify(snapshot)],
    );
    await db.exec('reset role; commit');
    return result.rows[0].result;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}

describe('MDF-e production load lifecycle migration', () => {
  it('parses and keeps exactly one durable fiscal manifest per load', async () => {
    const first = await prepare();
    const second = await prepare();
    const count = await db.query<{ total: number }>(
      'select count(*)::int total from load_manifests where tenant_id=$1 and load_id=$2 and external_id is not null',
      [ids.tenant, ids.load],
    );
    expect(count.rows[0].total).toBe(1);
    expect(second.id).toBe(first.id);
    expect(second.external_id).toBe(first.external_id);
    expect(second.request_payload).toMatchObject({
      externalId: first.external_id,
      payload: { idIntegracao: first.external_id, modalidadeDeTransporte: '1' },
    });
  });

  it('blocks closure before return and reserves it only once after arrival', async () => {
    const manifest = await prepare();
    await db.query("update load_manifests set status='authorized',hub_document_id='hub-mdfe-1' where id=$1", [manifest.id]);
    await expect(db.query(
      'select begin_mdfe_closure($1,$2,$3)', [ids.tenant, ids.actor, manifest.id],
    )).rejects.toThrow(/mdfe_load_not_returned/);
    await db.query('update loads set arrival_at=clock_timestamp() where id=$1', [ids.load]);
    const first = await db.query<{ result: { dispatch: boolean } }>(
      'select begin_mdfe_closure($1,$2,$3) result', [ids.tenant, ids.actor, manifest.id],
    );
    const repeated = await db.query<{ result: { dispatch: boolean; status: string } }>(
      'select begin_mdfe_closure($1,$2,$3) result', [ids.tenant, ids.actor, manifest.id],
    );
    expect(first.rows[0].result.dispatch).toBe(true);
    expect(repeated.rows[0].result).toMatchObject({ dispatch: false, status: 'closing' });
  });

  it('mirrors a confirmed Hub closure and preserves its protocol', async () => {
    const manifest = await prepare();
    await db.query(
      "insert into hub_fiscal_emissions(id,tenant_id,doc_type,status,dispatch_state,hub_document_id,load_manifest_id) values($1,$2,'mdfe','authorized','recorded','hub-mdfe-1',$3)",
      [ids.emission, ids.tenant, manifest.id],
    );
    await db.query(
      "update hub_fiscal_emissions set last_callback=$2::jsonb where id=$1",
      [ids.emission, JSON.stringify({ fiscalEvent: { kind: 'encerramento', status: 'authorized', protocol: '135260000000001' } })],
    );
    const current = await db.query<{ status: string; closure_protocol: string; closed_at: string | null }>(
      'select status,closure_protocol,closed_at from load_manifests where id=$1', [manifest.id],
    );
    expect(current.rows[0]).toMatchObject({ status: 'closed', closure_protocol: '135260000000001' });
    expect(current.rows[0].closed_at).not.toBeNull();
  });
});
