// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { createItemWriterDatabase, itemWriterIds as itemIds, seedItemWriter } from './helpers/loadItemWriterDatabase';
import { compositionRpc } from './helpers/compositionDatabase';

const mdfeRestore = readFileSync('supabase/migrations/20260926191456_restore_client_mdfe_documents_v1.sql', 'utf8');
const itemRestore = readFileSync('supabase/migrations/20260926191500_restore_delete_load_item_v4.sql', 'utf8');
const mdfeSignature = 'public.list_client_mdfe_documents_v1(uuid,uuid,text,date,date,integer,integer)';
const itemSignature = 'public.delete_load_item_v4(uuid,uuid,jsonb)';
const tenant = '11000000-0000-4000-8000-000000000001';
const actor = '11000000-0000-4000-8000-000000000003';
const client = '11000000-0000-4000-8000-000000000004';
const hiddenClient = '11000000-0000-4000-8000-000000000005';
const docA = '11000000-0000-4000-8000-000000000006';
const docB = '11000000-0000-4000-8000-000000000007';
const hiddenDoc = '11000000-0000-4000-8000-000000000008';
const manifestA = '11000000-0000-4000-8000-000000000009';
const manifestB = '11000000-0000-4000-8000-000000000010';
const manualItem = '81000000-0000-4000-8000-000000000080';

async function portalDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$select '${actor}'::uuid$$;
    create table public.client_portal_access(
      tenant_id uuid, user_id uuid, client_id uuid, active boolean
    );
    create function public._portal_user_client_ids(_tenant_id uuid)
    returns uuid[] language sql stable as $$
      select coalesce(array_agg(client_id), '{}'::uuid[])
      from public.client_portal_access
      where tenant_id=_tenant_id and user_id=auth.uid() and active
    $$;
    create function public._portal_assert_client_access(_tenant_id uuid,_client_id uuid)
    returns void language plpgsql stable as $$
    begin
      if not exists (
        select 1 from public.client_portal_access
        where tenant_id=_tenant_id and user_id=auth.uid() and active
          and (_client_id is null or client_id=_client_id)
      ) then raise exception 'portal_forbidden'; end if;
    end$$;
    create table public.fiscal_documents(
      id uuid primary key, tenant_id uuid, client_id uuid, load_id uuid
    );
    create table public.load_manifests(
      id uuid primary key, tenant_id uuid, external_id text,
      fiscal_document_ids uuid[], load_id uuid, issued_at timestamptz,
      created_at timestamptz, document_number text, manifest_number text,
      access_key text, responsible_name text, destination text, status text
    );
    insert into public.client_portal_access values ('${tenant}','${actor}','${client}',true);
    insert into public.fiscal_documents values
      ('${docA}','${tenant}','${client}',null),
      ('${docB}','${tenant}','${client}','11000000-0000-4000-8000-000000000013'),
      ('${hiddenDoc}','${tenant}','${hiddenClient}',null);
    insert into public.load_manifests
      (id,tenant_id,external_id,fiscal_document_ids,load_id,issued_at,created_at,
       document_number,access_key,responsible_name,destination,status) values
      ('${manifestA}','${tenant}','external-a',array['${docA}'::uuid],null,
       '2026-09-25','2026-09-25','MDFE-A','KEY-A','Remetente','São Paulo','issued'),
      ('${manifestB}','${tenant}','external-b','{}'::uuid[],'11000000-0000-4000-8000-000000000013',
       '2026-09-24','2026-09-24','MDFE-B','KEY-B','Remetente','Campinas','issued'),
      ('11000000-0000-4000-8000-000000000011','${tenant}','external-h',array['${hiddenDoc}'::uuid],null,
       '2026-09-23','2026-09-23','MDFE-H','KEY-H','Remetente','Santos','issued'),
      ('11000000-0000-4000-8000-000000000012','${tenant}',null,array['${docA}'::uuid],null,
       '2026-09-22','2026-09-22','MDFE-I','KEY-I','Remetente','Santos','draft');
  `);
  return db;
}

async function asAuthenticated<T>(db: PGlite, sql: string, params: unknown[] = []) {
  await db.exec('set role authenticated');
  try { return await db.query<T>(sql, params); }
  finally { await db.exec('reset role'); }
}

async function functionMetadata(db: PGlite, signature: string) {
  const result = await db.query<{
    definition: string; acl: string | null; security_definer: boolean; config: string[] | null;
  }>(`select pg_get_functiondef($1::regprocedure) definition,
    proacl::text acl, prosecdef security_definer, proconfig config
    from pg_proc where oid=$1::regprocedure`, [signature]);
  return result.rows[0];
}

describe('restauração das RPCs públicas ausentes', () => {
  it('MDFe: isola cliente, exige documento externo e respeita filtros', async () => {
    const db = await portalDatabase();
    try {
      await db.exec(mdfeRestore);
      const result = await asAuthenticated<{ id: string; invoice_number: string; client_id: string }>(
        db, 'select id,invoice_number,client_id from public.list_client_mdfe_documents_v1($1,$2)',
        [tenant, client]);
      expect(result.rows).toEqual([
        { id: manifestA, invoice_number: 'MDFE-A', client_id: client },
        { id: manifestB, invoice_number: 'MDFE-B', client_id: client },
      ]);
      const filtered = await asAuthenticated<{ id: string }>(
        db, 'select id from public.list_client_mdfe_documents_v1(_tenant_id=>$1,_client_id=>$2,_search=>$3,_start_date=>$4)',
        [tenant, client, 'MDFE-B', '2026-09-24']);
      expect(filtered.rows).toEqual([{ id: manifestB }]);
      await expect(asAuthenticated(db,
        'select * from public.list_client_mdfe_documents_v1($1,$2)', [tenant, hiddenClient]))
        .rejects.toThrow('portal_forbidden');
      await expect(asAuthenticated(db,
        'select * from public.list_client_mdfe_documents_v1(_tenant_id=>$1,_limit=>201)', [tenant]))
        .rejects.toThrow('portal_invalid_pagination');
      const privileges = await db.query<{ anon: boolean; authenticated: boolean; service_role: boolean }>(
        `select has_function_privilege('anon',$1,'EXECUTE') anon,
          has_function_privilege('authenticated',$1,'EXECUTE') authenticated,
          has_function_privilege('service_role',$1,'EXECUTE') service_role`, [mdfeSignature]);
      expect(privileges.rows[0]).toEqual({ anon: false, authenticated: true, service_role: true });
      expect((await functionMetadata(db, mdfeSignature)).security_definer).toBe(true);
    } finally { await db.close(); }
  }, 30_000);

  it('MDFe: preflight detecta coluna e helper ausentes', async () => {
    const columns = await portalDatabase();
    const helpers = await portalDatabase();
    try {
      await columns.exec('alter table public.load_manifests drop column fiscal_document_ids');
      await expect(columns.exec(mdfeRestore)).rejects.toThrow('fiscal_document_ids');
      expect((await columns.query<{ found: string | null }>(
        'select to_regprocedure($1) as found', [mdfeSignature])).rows[0].found).toBeNull();
      await helpers.exec('drop function public._portal_user_client_ids(uuid)');
      await expect(helpers.exec(mdfeRestore)).rejects.toThrow('dependency_missing');
    } finally { await columns.close(); await helpers.close(); }
  }, 30_000);

  it('exclusão: rejeita snapshot antigo e remove estado exato, com ACL restrita', async () => {
    const db = await createItemWriterDatabase();
    try {
      await db.exec(itemRestore);
      await seedItemWriter(db);
      await db.query(
        `insert into load_items(id,tenant_id,load_id,item_description,quantity,pallet_count,weight_kg,volume_m3,status)
         values($1,$2,$3,'Item manual',1,1,10,0,'pending')`,
        [manualItem, itemIds.tenant, itemIds.load]);
      const snapshotQuery = `select jsonb_build_object(
        'order_id',order_id,'item_description',item_description,'quantity',quantity,'pallet_count',pallet_count,
        'weight_kg',weight_kg,'volume_m3',volume_m3,'status',status,'notes',notes,'updated_at',updated_at
      ) value from load_items where id=$1`;
      const snapshot = (await db.query<{ value: unknown }>(snapshotQuery, [manualItem])).rows[0].value;
      await db.query("update load_items set item_description='Edição concorrente' where id=$1", [manualItem]);
      await expect(compositionRpc(db, 'select public.delete_load_item_v4($1,$2,$3)', [
        itemIds.tenant, manualItem, snapshot])).rejects.toThrow('load_item_expected_changed');
      expect((await db.query<{ n: number }>(
        'select count(*)::int n from load_items where id=$1', [manualItem])).rows[0].n).toBe(1);
      const latest = (await db.query<{ value: unknown }>(snapshotQuery, [manualItem])).rows[0].value;
      expect((await compositionRpc(db,
        'select public.delete_load_item_v4($1,$2,$3) removed',
        [itemIds.tenant, manualItem, latest])).rows[0]).toEqual({ removed: true });
      expect((await db.query<{ n: number }>(
        'select count(*)::int n from load_items where id=$1', [manualItem])).rows[0].n).toBe(0);
      const privileges = await db.query<{ anon: boolean; authenticated: boolean; service_role: boolean }>(
        `select has_function_privilege('anon',$1,'EXECUTE') anon,
          has_function_privilege('authenticated',$1,'EXECUTE') authenticated,
          has_function_privilege('service_role',$1,'EXECUTE') service_role`, [itemSignature]);
      expect(privileges.rows[0]).toEqual({ anon: false, authenticated: true, service_role: false });
    } finally { await db.close(); }
  }, 30_000);

  it('exclusão: preflight rejeita helper e coluna ausentes sem criar a função', async () => {
    const helperDb = await createItemWriterDatabase();
    const columnDb = await createItemWriterDatabase();
    try {
      await helperDb.exec('drop function public._lock_load_document_graph(uuid,uuid)');
      await expect(helperDb.exec(itemRestore)).rejects.toThrow('dependency_missing');
      await columnDb.exec('alter table public.load_items drop column notes cascade');
      await columnDb.exec('create view public.current_load_items as select * from public.load_items');
      await expect(columnDb.exec(itemRestore)).rejects.toThrow('notes');
      for (const db of [helperDb, columnDb]) {
        expect((await db.query<{ found: string | null }>(
          'select to_regprocedure($1) as found', [itemSignature])).rows[0].found).toBeNull();
      }
    } finally { await helperDb.close(); await columnDb.close(); }
  }, 30_000);

  it('preserva corpo e ACL das duas assinaturas preexistentes', async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create role anon; create role authenticated; create role service_role;
        create function public.list_client_mdfe_documents_v1(
          uuid,uuid,text,date,date,integer,integer
        ) returns integer language sql as $$select 17$$;
        create function public.delete_load_item_v4(uuid,uuid,jsonb)
        returns boolean language sql as $$select false$$;
        revoke all on function public.list_client_mdfe_documents_v1(uuid,uuid,text,date,date,integer,integer)
          from public,anon,authenticated,service_role;
        grant execute on function public.list_client_mdfe_documents_v1(uuid,uuid,text,date,date,integer,integer)
          to anon;
      `);
      const portalBefore = await functionMetadata(db, mdfeSignature);
      const itemBefore = await functionMetadata(db, itemSignature);
      await db.exec(mdfeRestore);
      await db.exec(itemRestore);
      expect(await functionMetadata(db, mdfeSignature)).toEqual(portalBefore);
      expect(await functionMetadata(db, itemSignature)).toEqual(itemBefore);
    } finally { await db.close(); }
  }, 30_000);
});
