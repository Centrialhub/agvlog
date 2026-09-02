// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { operationRpc } from './helpers/operationOutcomeDatabase';

const migration = readFileSync(
  'supabase/migrations/20260902004250_add_driver_fiscal_file_reader.sql',
  'utf8',
);

const ids = {
  tenant: '20000000-0000-4000-8000-000000000001',
  otherTenant: '20000000-0000-4000-8000-000000000002',
  user: '10000000-0000-4000-8000-000000000001',
  otherUser: '10000000-0000-4000-8000-000000000002',
  operatorUser: '10000000-0000-4000-8000-000000000003',
  portalUser: '10000000-0000-4000-8000-000000000004',
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

async function roleRpc<Row = Record<string, unknown>>(
  role: 'anon' | 'authenticated' | 'service_role',
  sql: string,
  params: unknown[] = [],
) {
  await db.exec(`savepoint role_rpc;set role ${role}`);
  try {
    const result = await db.query<Row>(sql, params);
    await db.exec('reset role;release savepoint role_rpc');
    return result;
  } catch (error) {
    await db.exec('rollback to savepoint role_rpc;release savepoint role_rpc');
    throw error;
  }
}

async function catalog(tenant = ids.tenant, load = ids.load) {
  return (await operationRpc<{ result: Catalog }>(
    db,
    'select public.driver_list_load_fiscal_catalog($1,$2) result',
    [tenant, load],
  )).rows[0].result;
}

async function fiscalFile(
  kind: 'cte' | 'nfse',
  documentId: string,
  format: 'pdf' | 'xml',
  tenant = ids.tenant,
  load = ids.load,
) {
  return (await operationRpc<{ result: Record<string, unknown> }>(
    db,
    'select public.driver_get_load_fiscal_file($1,$2,$3,$4,$5) result',
    [tenant, load, kind, documentId, format],
  )).rows[0].result;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec([
    'create role anon;',
    'create role authenticated;',
    'create role service_role bypassrls;',
    'create schema auth;',
    "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;",
    'create table tenant_memberships(tenant_id uuid,user_id uuid,active boolean,role text);',
    'create table drivers(id uuid primary key,tenant_id uuid,user_id uuid,active boolean);',
    'create table loads(id uuid primary key,tenant_id uuid,driver_id uuid,trip_id uuid,on_hold boolean);',
    'create table dispatch_trips(id uuid primary key,tenant_id uuid,driver_id uuid);',
    'create table dispatch_trip_loads(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,load_id uuid);',
    'create table fiscal_documents(id uuid primary key,tenant_id uuid,load_id uuid,document_type text,deleted_at timestamptz,status text,invoice_number text,invoice_series text,issue_date date,remitter text,recipient text,recipient_city text,recipient_state text,value numeric,weight_kg numeric,volume_count numeric,pallet_count integer,access_key text,cte_payload jsonb);',
    'create table cte_documents(id uuid primary key,tenant_id uuid,status text,cancelled_at timestamptz,is_voided boolean,load_ids uuid[],fiscal_document_ids uuid[],issued_at timestamptz,cte_number text,reference_number text,internal_number text,cte_series text,remitter text,recipient text,recipient_city text,recipient_state text,freight_value numeric,weight_kg numeric,pallet_count integer,access_key text,protocol_number text,xml_url text,xml_content text,pdf_url text);',
    'create table nfse_documents(id uuid primary key,tenant_id uuid,status text,cancelled boolean,is_preview boolean,load_id uuid,trip_id uuid,fiscal_document_ids uuid[],related_cte_ids uuid[],authorization_date timestamptz,issue_date date,nfse_number text,invoice_number text,rps_number text,series text,cliente_nome text,cliente_municipio text,cliente_uf text,valor_total numeric,protocol_number text,raw_response jsonb,xml_url text,pdf_url text);',
    'alter table tenant_memberships enable row level security;',
    'alter table drivers enable row level security;',
    'alter table loads enable row level security;',
    'alter table dispatch_trips enable row level security;',
    'alter table dispatch_trip_loads enable row level security;',
    'alter table fiscal_documents enable row level security;',
    'alter table cte_documents enable row level security;',
    'alter table nfse_documents enable row level security;',
    'grant usage on schema public,auth to authenticated;',
    'grant select on tenant_memberships,drivers,loads,dispatch_trips,dispatch_trip_loads,fiscal_documents to authenticated;',
    'grant select,insert,update,delete on cte_documents,nfse_documents to authenticated;',
    'grant all privileges on cte_documents,nfse_documents to service_role;',
    "create function is_tenant_member(_tenant_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.tenant_memberships where tenant_id=_tenant_id and user_id=auth.uid() and active)$$;",
    "create function is_user_internal_role(_tenant_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.tenant_memberships where tenant_id=_tenant_id and user_id=auth.uid() and active and role in('owner','admin','operator'))$$;",
    "create function is_tenant_admin(_tenant_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.tenant_memberships where tenant_id=_tenant_id and user_id=auth.uid() and active and role in('owner','admin'))$$;",
    'grant execute on function is_tenant_member(uuid),is_user_internal_role(uuid),is_tenant_admin(uuid) to authenticated;',
    "create policy test_driver_membership_select on tenant_memberships for select to authenticated using(user_id=auth.uid() and active);",
    "create policy test_driver_identity_select on drivers for select to authenticated using(user_id=auth.uid() and active);",
    "create policy test_driver_tenant_select on loads for select to authenticated using(tenant_id in(select tenant_id from tenant_memberships where user_id=auth.uid() and active));",
    "create policy test_driver_tenant_select on dispatch_trips for select to authenticated using(tenant_id in(select tenant_id from tenant_memberships where user_id=auth.uid() and active));",
    "create policy test_driver_tenant_select on dispatch_trip_loads for select to authenticated using(tenant_id in(select tenant_id from tenant_memberships where user_id=auth.uid() and active));",
    "create policy test_driver_tenant_select on fiscal_documents for select to authenticated using(tenant_id in(select tenant_id from tenant_memberships where user_id=auth.uid() and active));",
    "create policy agvlog_delete_anon on cte_documents for delete to anon using(is_tenant_admin(tenant_id));",
    "create policy agvlog_insert_anon on cte_documents for insert to anon with check(is_tenant_member(tenant_id));",
    "create policy agvlog_select_anon on cte_documents for select to anon using(is_tenant_member(tenant_id));",
    "create policy agvlog_update_anon on cte_documents for update to anon using(is_tenant_member(tenant_id)) with check(is_tenant_member(tenant_id));",
    "create policy agvlog_delete_authenticated on cte_documents for delete to authenticated using(is_tenant_admin(tenant_id));",
    "create policy agvlog_insert_authenticated on cte_documents for insert to authenticated with check(is_tenant_member(tenant_id));",
    "create policy agvlog_select_authenticated on cte_documents for select to authenticated using(is_tenant_member(tenant_id));",
    "create policy agvlog_update_authenticated on cte_documents for update to authenticated using(is_tenant_member(tenant_id)) with check(is_tenant_member(tenant_id));",
    "create policy agvlog_delete_anon on nfse_documents for delete to anon using(is_tenant_admin(tenant_id));",
    "create policy agvlog_insert_anon on nfse_documents for insert to anon with check(is_tenant_member(tenant_id));",
    "create policy agvlog_select_anon on nfse_documents for select to anon using(is_tenant_member(tenant_id));",
    "create policy agvlog_update_anon on nfse_documents for update to anon using(is_tenant_member(tenant_id)) with check(is_tenant_member(tenant_id));",
    "create policy agvlog_delete_authenticated on nfse_documents for delete to authenticated using(is_tenant_admin(tenant_id));",
    "create policy agvlog_insert_authenticated on nfse_documents for insert to authenticated with check(is_tenant_member(tenant_id));",
    "create policy agvlog_select_authenticated on nfse_documents for select to authenticated using(is_tenant_member(tenant_id));",
    "create policy agvlog_update_authenticated on nfse_documents for update to authenticated using(is_tenant_member(tenant_id)) with check(is_tenant_member(tenant_id));",
  ].join('\n'));
  await db.exec(migration);
  await db.query(
    "insert into tenant_memberships values($1,$2,true,'driver'),($1,$3,true,'driver'),($4,$3,true,'driver'),($1,$5,true,'operator'),($1,$6,true,'client')",
    [ids.tenant, ids.user, ids.otherUser, ids.otherTenant, ids.operatorUser, ids.portalUser],
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
    "insert into cte_documents values($1,$2,'authorized',null,false,array[$3]::uuid[],array[$4]::uuid[],'2026-08-31T12:00:00Z','7001',null,null,'1','Emitente','Destinatário','Montes Claros','MG',180,450,3,'CTE-SECRET','PROTOCOL-SECRET',null,'<xml/>','https://files.example.test/cte-7001.pdf'),($5,$2,'rejected',null,false,array[$3]::uuid[],array[$4]::uuid[],null,'7002',null,null,'1','Emitente','Destinatário','Montes Claros','MG',180,450,3,'REJECTED',null,null,null,null)",
    [ids.cte, ids.tenant, ids.load, ids.note, ids.rejectedCte],
  );
  await db.query(
    "insert into nfse_documents values($1,$2,'issued',false,false,$3,$4,array[$5]::uuid[],array[$6]::uuid[],'2026-08-31T13:00:00Z','2026-08-31','8001',null,'RPS-1','1','Cliente','Montes Claros','MG',180,'NFSE-PROTOCOL','{\"secret\":true}','https://files.example.test/nfse-8001.xml','/relative/nfse-8001.pdf'),($7,$2,'issued',true,false,$3,$4,array[$5]::uuid[],array[$6]::uuid[],null,'2026-08-31','8002',null,'RPS-2','1','Cliente','Montes Claros','MG',180,'CANCELLED',null,null,null)",
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
    expect(result.documents.find((document) => document.kind === 'nfe')?.available_files).toEqual({ pdf: false, xml: false });
    expect(result.documents.find((document) => document.kind === 'cte')?.available_files).toEqual({ pdf: true, xml: true });
    expect(result.documents.find((document) => document.kind === 'nfse')?.available_files).toEqual({ pdf: false, xml: true });
    const serialized = JSON.stringify(result);
    for (const secret of ['NFE-SECRET', 'CTE-SECRET', 'PROTOCOL-SECRET', 'NFSE-PROTOCOL', '<xml/>', 'files.example.test']) {
      expect(serialized).not.toContain(secret);
    }
    for (const unsafeKey of ['access_key', 'protocol_number', 'xml_content', 'xml_url', 'pdf_url', 'raw_response', 'cte_payload']) {
      expect(serialized).not.toContain(unsafeKey);
    }
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

  it('exposes only invoker wrappers and keeps one privileged helper outside the Data API', async () => {
    const acl = await db.query<{ list_anon: boolean; list_authenticated: boolean; list_service: boolean; file_anon: boolean; file_authenticated: boolean; file_service: boolean; helper_anon: boolean; helper_authenticated: boolean; helper_service: boolean; private_anon: boolean; private_authenticated: boolean }>(
      "select has_function_privilege('anon','public.driver_list_load_fiscal_catalog(uuid,uuid)','EXECUTE') list_anon,has_function_privilege('authenticated','public.driver_list_load_fiscal_catalog(uuid,uuid)','EXECUTE') list_authenticated,has_function_privilege('service_role','public.driver_list_load_fiscal_catalog(uuid,uuid)','EXECUTE') list_service,has_function_privilege('anon','public.driver_get_load_fiscal_file(uuid,uuid,text,uuid,text)','EXECUTE') file_anon,has_function_privilege('authenticated','public.driver_get_load_fiscal_file(uuid,uuid,text,uuid,text)','EXECUTE') file_authenticated,has_function_privilege('service_role','public.driver_get_load_fiscal_file(uuid,uuid,text,uuid,text)','EXECUTE') file_service,has_function_privilege('anon','private.driver_read_load_fiscal(uuid,uuid,text,uuid,text)','EXECUTE') helper_anon,has_function_privilege('authenticated','private.driver_read_load_fiscal(uuid,uuid,text,uuid,text)','EXECUTE') helper_authenticated,has_function_privilege('service_role','private.driver_read_load_fiscal(uuid,uuid,text,uuid,text)','EXECUTE') helper_service,has_schema_privilege('anon','private','USAGE') private_anon,has_schema_privilege('authenticated','private','USAGE') private_authenticated",
    );
    expect(acl.rows[0]).toEqual({
      list_anon: false,
      list_authenticated: true,
      list_service: false,
      file_anon: false,
      file_authenticated: true,
      file_service: false,
      helper_anon: false,
      helper_authenticated: true,
      helper_service: false,
      private_anon: false,
      private_authenticated: true,
    });
    const definitions = await db.query<{ schema_name: string; function_name: string; body: string; security_definer: boolean }>(
      "select n.nspname schema_name,p.proname function_name,pg_get_functiondef(p.oid) body,p.prosecdef security_definer from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid in ('public.driver_list_load_fiscal_catalog(uuid,uuid)'::regprocedure,'public.driver_get_load_fiscal_file(uuid,uuid,text,uuid,text)'::regprocedure,'private.driver_read_load_fiscal(uuid,uuid,text,uuid,text)'::regprocedure)",
    );
    expect(definitions.rows.filter((definition) => definition.security_definer).map((definition) => `${definition.schema_name}.${definition.function_name}`)).toEqual(['private.driver_read_load_fiscal']);
    for (const { schema_name, body } of definitions.rows) {
      expect(body).not.toMatch(/\b(insert|update|delete|http|net|invoke|provider_request)\b/i);
      expect(body).toContain("SET search_path TO ''");
      if (schema_name === 'public') {
        expect(body).toContain('SET row_security TO \'on\'');
        expect(body).not.toMatch(/public\.(cte_documents|nfse_documents|fiscal_documents)/);
      }
    }
  });

  it('denies fiscal base tables to drivers/portal while preserving internal and service access', async () => {
    const sensitiveSql = "select access_key,protocol_number,xml_content,null::jsonb raw_response from cte_documents union all select null,protocol_number,null,raw_response from nfse_documents";
    expect((await operationRpc(db, sensitiveSql)).rows).toEqual([]);
    expect((await operationRpc(db, "update cte_documents set access_key='DRIVER-WRITE' where id=$1 returning id", [ids.cte])).rows).toEqual([]);

    await actor(ids.portalUser);
    expect((await operationRpc(db, sensitiveSql)).rows).toEqual([]);

    await actor(ids.operatorUser);
    const internalRows = (await operationRpc<Record<string, unknown>>(db, sensitiveSql)).rows;
    expect(JSON.stringify(internalRows)).toContain('CTE-SECRET');
    expect(JSON.stringify(internalRows)).toContain('NFSE-PROTOCOL');
    expect((await operationRpc(db, "update cte_documents set access_key='OPERATOR-WRITE' where id=$1 returning access_key", [ids.cte])).rows).toEqual([{ access_key: 'OPERATOR-WRITE' }]);

    await actor(null);
    const serviceRows = (await roleRpc<Record<string, unknown>>('service_role', sensitiveSql)).rows;
    expect(serviceRows).toHaveLength(4);
    await expect(roleRpc('anon', 'select id from cte_documents')).rejects.toThrow(/permission denied/i);

    const policies = await db.query<{ table_name: string; policy_count: number; roles: string[] }>(
      "select c.relname table_name,count(*)::int policy_count,array_agg(distinct coalesce(r.rolname,'PUBLIC') order by coalesce(r.rolname,'PUBLIC')) roles from pg_policy p join pg_class c on c.oid=p.polrelid cross join unnest(p.polroles) policy_role(oid) left join pg_roles r on r.oid=policy_role.oid where c.relname in('cte_documents','nfse_documents') group by c.relname order by c.relname",
    );
    expect(policies.rows).toEqual([
      { table_name: 'cte_documents', policy_count: 4, roles: ['authenticated'] },
      { table_name: 'nfse_documents', policy_count: 4, roles: ['authenticated'] },
    ]);
  });

  it('returns only the requested stored file after rechecking the load/document graph', async () => {
    expect(await fiscalFile('cte', ids.cte, 'pdf')).toEqual({
      load_id: ids.load,
      kind: 'cte',
      document_id: ids.cte,
      format: 'pdf',
      source: 'url',
      filename: 'cte-7001.pdf',
      url: 'https://files.example.test/cte-7001.pdf',
    });
    expect(await fiscalFile('cte', ids.cte, 'xml')).toEqual({
      load_id: ids.load,
      kind: 'cte',
      document_id: ids.cte,
      format: 'xml',
      source: 'inline',
      filename: 'cte-7001.xml',
      content: '<xml/>',
    });
    expect((await fiscalFile('nfse', ids.nfse, 'xml')).source).toBe('url');
    await expect(fiscalFile('nfse', ids.nfse, 'pdf')).rejects.toThrow('not_authorized');
    await expect(fiscalFile('cte', ids.rejectedCte, 'pdf')).rejects.toThrow('not_authorized');
    await expect(fiscalFile('cte', ids.cte, 'xml', ids.tenant, ids.otherLoad)).rejects.toThrow('not_authorized');
    await expect(operationRpc(db, "select public.driver_get_load_fiscal_file($1,$2,'nfe',$3,'pdf')", [ids.tenant, ids.load, ids.note])).rejects.toThrow('invalid_file_request');
    await actor(null);
    await expect(fiscalFile('cte', ids.cte, 'pdf')).rejects.toThrow('not_authorized');
  });
});
