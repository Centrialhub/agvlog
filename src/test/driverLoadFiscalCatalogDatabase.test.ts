// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { operationRpc } from './helpers/operationOutcomeDatabase';

const migration = readFileSync(
  'supabase/migrations/20260901135909_driver_load_fiscal_catalog.sql',
  'utf8',
);

const ids = {
  tenant: '20000000-0000-4000-8000-000000000001',
  otherTenant: '20000000-0000-4000-8000-000000000002',
  user: '10000000-0000-4000-8000-000000000001',
  otherUser: '10000000-0000-4000-8000-000000000002',
  driver: '60000000-0000-4000-8000-000000000001',
  otherDriver: '60000000-0000-4000-8000-000000000002',
  trip: '70000000-0000-4000-8000-000000000001',
  otherTrip: '70000000-0000-4000-8000-000000000002',
  load: '80000000-0000-4000-8000-000000000001',
  otherLoad: '80000000-0000-4000-8000-000000000002',
  note: '90000000-0000-4000-8000-000000000001',
  deletedNote: '90000000-0000-4000-8000-000000000002',
  cte: 'a0000000-0000-4000-8000-000000000001',
  rejectedCte: 'a0000000-0000-4000-8000-000000000002',
  nfse: 'b0000000-0000-4000-8000-000000000001',
  cancelledNfse: 'b0000000-0000-4000-8000-000000000002',
};

interface Catalog {
  load_id: string;
  documents: Array<Record<string, unknown>>;
}

let db: PGlite;

async function actor(user: string | null) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user || '']);
}

async function catalog(tenant = ids.tenant, load = ids.load) {
  return (await operationRpc<{ result: Catalog }>(
    db,
    'select public.driver_list_load_fiscal_catalog($1,$2) result',
    [tenant, load],
  )).rows[0].result;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec([
    'create role anon;',
    'create role authenticated;',
    'create role service_role;',
    'create schema auth;',
    "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;",
    'create table tenant_memberships(tenant_id uuid,user_id uuid,active boolean);',
    'create table drivers(id uuid primary key,tenant_id uuid,user_id uuid,active boolean);',
    'create table loads(id uuid primary key,tenant_id uuid,driver_id uuid,trip_id uuid,on_hold boolean);',
    'create table dispatch_trips(id uuid primary key,tenant_id uuid,driver_id uuid);',
    'create table dispatch_trip_loads(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,load_id uuid);',
    'create table fiscal_documents(id uuid primary key,tenant_id uuid,load_id uuid,document_type text,deleted_at timestamptz,status text,invoice_number text,invoice_series text,issue_date date,remitter text,recipient text,recipient_city text,recipient_state text,value numeric,weight_kg numeric,volume_count numeric,pallet_count integer,access_key text,cte_payload jsonb);',
    'create table cte_documents(id uuid primary key,tenant_id uuid,status text,cancelled_at timestamptz,is_voided boolean,load_ids uuid[],fiscal_document_ids uuid[],issued_at timestamptz,cte_number text,reference_number text,internal_number text,cte_series text,remitter text,recipient text,recipient_city text,recipient_state text,freight_value numeric,weight_kg numeric,pallet_count integer,access_key text,protocol_number text,xml_content text,pdf_url text);',
    'create table nfse_documents(id uuid primary key,tenant_id uuid,status text,cancelled boolean,is_preview boolean,load_id uuid,trip_id uuid,fiscal_document_ids uuid[],related_cte_ids uuid[],authorization_date timestamptz,issue_date date,nfse_number text,invoice_number text,rps_number text,series text,cliente_nome text,cliente_municipio text,cliente_uf text,valor_total numeric,protocol_number text,raw_response jsonb,xml_url text,pdf_url text);',
    'alter table fiscal_documents enable row level security;',
    'alter table cte_documents enable row level security;',
    'alter table nfse_documents enable row level security;',
    'grant usage on schema public,auth to authenticated;',
    'grant select on fiscal_documents,cte_documents,nfse_documents to authenticated;',
  ].join('\n'));
  await db.exec(migration);
  await db.query(
    'insert into tenant_memberships values($1,$2,true),($1,$3,true),($4,$3,true)',
    [ids.tenant, ids.user, ids.otherUser, ids.otherTenant],
  );
  await db.query(
    'insert into drivers values($1,$2,$3,true),($4,$2,$5,true)',
    [ids.driver, ids.tenant, ids.user, ids.otherDriver, ids.otherUser],
  );
  await db.query(
    'insert into dispatch_trips values($1,$2,$3),($4,$2,$5)',
    [ids.trip, ids.tenant, ids.driver, ids.otherTrip, ids.otherDriver],
  );
  await db.query(
    'insert into loads values($1,$2,$3,$4,false),($5,$2,$6,$7,false)',
    [ids.load, ids.tenant, ids.driver, ids.trip, ids.otherLoad, ids.otherDriver, ids.otherTrip],
  );
  await db.query(
    'insert into dispatch_trip_loads values(gen_random_uuid(),$1,$2,$3),(gen_random_uuid(),$1,$4,$5)',
    [ids.tenant, ids.trip, ids.load, ids.otherTrip, ids.otherLoad],
  );
  await db.query(
    "insert into fiscal_documents values($1,$2,$3,'inbound',null,'confirmed','1012','1','2026-08-31','Emitente','Destinatário','Montes Claros','MG',1200,450,12,3,'NFE-SECRET','{\"provider\":\"secret\"}'),($4,$2,$3,'inbound',now(),'deleted','999','1','2026-08-30','Oculto','Oculto','Oculto','MG',1,1,1,1,'DELETED',null)",
    [ids.note, ids.tenant, ids.load, ids.deletedNote],
  );
  await db.query(
    "insert into cte_documents values($1,$2,'authorized',null,false,array[$3]::uuid[],array[$4]::uuid[],'2026-08-31T12:00:00Z','7001',null,null,'1','Emitente','Destinatário','Montes Claros','MG',180,450,3,'CTE-SECRET','PROTOCOL-SECRET','<xml/>','secret.pdf'),($5,$2,'rejected',null,false,array[$3]::uuid[],array[$4]::uuid[],null,'7002',null,null,'1','Emitente','Destinatário','Montes Claros','MG',180,450,3,'REJECTED',null,null,null)",
    [ids.cte, ids.tenant, ids.load, ids.note, ids.rejectedCte],
  );
  await db.query(
    "insert into nfse_documents values($1,$2,'issued',false,false,$3,$4,array[$5]::uuid[],array[$6]::uuid[],'2026-08-31T13:00:00Z','2026-08-31','8001',null,'RPS-1','1','Cliente','Montes Claros','MG',180,'NFSE-PROTOCOL','{\"secret\":true}','secret.xml','secret.pdf'),($7,$2,'issued',true,false,$3,$4,array[$5]::uuid[],array[$6]::uuid[],null,'2026-08-31','8002',null,'RPS-2','1','Cliente','Montes Claros','MG',180,'CANCELLED',null,null,null)",
    [ids.nfse, ids.tenant, ids.load, ids.trip, ids.note, ids.cte, ids.cancelledNfse],
  );
}, 30_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec('begin');
  await actor(ids.user);
});

afterEach(async () => {
  await db.exec('rollback');
});

describe('driver load fiscal catalog SQL/RLS boundary', () => {
  it('returns only safe load NF-e and already-authorized CT-e/NFS-e metadata', async () => {
    const result = await catalog();
    expect(result.load_id).toBe(ids.load);
    expect(result.documents.map((document) => document.kind).sort()).toEqual(['cte', 'nfe', 'nfse']);
    expect(result.documents.map((document) => document.number).sort()).toEqual(['1012', '7001', '8001']);
    const serialized = JSON.stringify(result);
    for (const secret of ['NFE-SECRET', 'CTE-SECRET', 'PROTOCOL-SECRET', 'NFSE-PROTOCOL', '<xml/>', 'secret.pdf']) {
      expect(serialized).not.toContain(secret);
    }
    for (const unsafeKey of ['access_key', 'protocol_number', 'xml_content', 'xml_url', 'pdf_url', 'raw_response', 'cte_payload']) {
      expect(serialized).not.toContain(unsafeKey);
    }
    const direct = await operationRpc(
      db,
      "select id from fiscal_documents union all select id from cte_documents union all select id from nfse_documents",
    );
    expect(direct.rows).toEqual([]);
  });

  it('denies another driver load, anonymous access and a cross-tenant request', async () => {
    await expect(catalog(ids.tenant, ids.otherLoad)).rejects.toThrow('not_authorized');
    await expect(catalog(ids.otherTenant, ids.load)).rejects.toThrow('not_authorized');
    await actor(null);
    await expect(catalog()).rejects.toThrow('not_authorized');
  });

  it('fails closed after driver or membership revocation and on a contradictory trip graph', async () => {
    await db.query('update drivers set active=false where id=$1', [ids.driver]);
    await expect(catalog()).rejects.toThrow('not_authorized');
    await db.query('update drivers set active=true where id=$1', [ids.driver]);
    await db.query('update tenant_memberships set active=false where tenant_id=$1 and user_id=$2', [ids.tenant, ids.user]);
    await expect(catalog()).rejects.toThrow('not_authorized');
    await db.query('update tenant_memberships set active=true where tenant_id=$1 and user_id=$2', [ids.tenant, ids.user]);
    await db.query('update dispatch_trip_loads set dispatch_trip_id=$1 where load_id=$2', [ids.otherTrip, ids.load]);
    await expect(catalog()).rejects.toThrow('not_authorized');
  });

  it('exposes the read RPC only to authenticated and contains no fiscal/provider writer', async () => {
    const acl = await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>(
      "select has_function_privilege('anon','public.driver_list_load_fiscal_catalog(uuid,uuid)','EXECUTE') anon,has_function_privilege('authenticated','public.driver_list_load_fiscal_catalog(uuid,uuid)','EXECUTE') authenticated,has_function_privilege('service_role','public.driver_list_load_fiscal_catalog(uuid,uuid)','EXECUTE') service",
    );
    expect(acl.rows[0]).toEqual({ anon: false, authenticated: true, service: false });
    const definition = (await db.query<{ body: string }>(
      "select pg_get_functiondef('public.driver_list_load_fiscal_catalog(uuid,uuid)'::regprocedure) body",
    )).rows[0].body;
    expect(definition).not.toMatch(/\b(insert|update|delete|http|net|invoke|provider_request)\b/i);
  });
});
