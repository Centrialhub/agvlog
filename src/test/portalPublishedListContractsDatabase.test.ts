// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tenant = '00000000-0000-4000-8000-000000000101';
const otherTenant = '00000000-0000-4000-8000-000000000102';
const actor = '00000000-0000-4000-8000-000000000103';
const client = '00000000-0000-4000-8000-000000000104';
const owner = '00000000-0000-4000-8000-000000000105';
const directDoc = '00000000-0000-4000-8000-000000000106';
const inboundDoc = '00000000-0000-4000-8000-000000000107';
const outboundDoc = '00000000-0000-4000-8000-000000000108';
const hiddenDoc = '00000000-0000-4000-8000-000000000109';
const foreignLoad = '00000000-0000-4000-8000-000000000110';
const repair = readFileSync('supabase/migrations/20260926183928_restore_portal_list_contracts.sql', 'utf8');

function publishedDefinition(name: string, file: string): string {
  const source = readFileSync(`supabase/migrations/${file}.sql`, 'utf8');
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = source.indexOf('$function$;', start);
  if (start < 0 || end < 0) throw new Error(`Published Portal definition missing: ${name}`);
  return source.slice(start, end + '$function$;'.length);
}

const publishedDocuments = publishedDefinition('list_client_documents_v2',
  '20260830120554_version_delivery_proof_evidence');
const publishedShipments = publishedDefinition('search_client_portal_shipments_v2',
  '20260830142048_enable_audited_delivery_reallocation');

async function setup(selectedGrant: boolean): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$select '${actor}'::uuid$$;
    create table public.clients(id uuid primary key,tenant_id uuid,tax_id text);
    create table public.client_portal_access(tenant_id uuid,user_id uuid,client_id uuid,active boolean,access_type text);
    create table public.fiscal_documents(
      id uuid primary key,tenant_id uuid,client_id uuid,load_id uuid,pickup_order_id uuid,
      document_type text,invoice_number text,access_key text,issue_date date,
      remitter text,remitter_cnpj text,recipient text,recipient_cnpj text,
      recipient_city text,recipient_state text,recipient_neighborhood text,product_summary text,
      value numeric,freight_value numeric,weight_kg numeric,volume_count numeric,pallet_count integer,
      status text,client_load_number text,reference_number text,created_at timestamptz,updated_at timestamptz
    );
    create table public.loads(id uuid primary key,tenant_id uuid,load_number text,status text,trip_id uuid);
    create table public.available_delivery_proofs(fiscal_document_id uuid,status text);
    create table public.current_dispatch_stop_documents(fiscal_document_id uuid,dispatch_stop_id uuid);
    create table public.dispatch_stops(id uuid primary key,status text,planned_arrival_at timestamptz,
      actual_arrival_at timestamptz,actual_departure_at timestamptz);
    create table public.operational_events(tenant_id uuid,visible_to_client boolean,public_status text,
      fiscal_document_id uuid,dispatch_stop_id uuid,client_id uuid);
    create function public._portal_assert_client_access(_tenant_id uuid,_client_id uuid)
      returns void language plpgsql stable as $$begin
        if _tenant_id is distinct from '${tenant}'::uuid or not exists(
          select 1 from public.client_portal_access cpa where cpa.tenant_id=_tenant_id
            and cpa.user_id=auth.uid() and cpa.active
            and (_client_id is null or cpa.client_id=_client_id))
        then raise exception 'portal_forbidden'; end if;
      end$$;
    create function public.portal_user_can_access_fiscal_document(_tenant_id uuid,_id uuid)
      returns boolean language sql stable as $$
        select exists(select 1 from public.fiscal_documents fd
          join public.client_portal_access cpa on cpa.tenant_id=fd.tenant_id
            and cpa.user_id=auth.uid() and cpa.active
          left join public.clients c on c.id=cpa.client_id and c.tenant_id=cpa.tenant_id
          where fd.id=_id and fd.tenant_id=_tenant_id
            and (fd.client_id=cpa.client_id or
              (cpa.access_type='remitter' and c.tax_id=fd.remitter_cnpj)))
      $$;
    create function public.portal_user_can_view_financial(uuid,uuid)
      returns boolean language sql stable as $$select false$$;
    create function public.get_public_shipment_status(uuid)
      returns text language sql stable as $$select 'in_transit'::text$$;
    insert into public.clients values
      ('${client}','${tenant}','111'),('${owner}','${tenant}','222');
    insert into public.client_portal_access values
      ('${tenant}','${actor}','${client}',true,'remitter');
    insert into public.loads values
      ('${foreignLoad}','${otherTenant}','FOREIGN-LOAD','in_transit','00000000-0000-4000-8000-000000000111');
    insert into public.fiscal_documents
      (id,tenant_id,client_id,load_id,volume_count,document_type,invoice_number,issue_date,
       remitter,remitter_cnpj,recipient,recipient_cnpj,status,created_at,updated_at)
      values
      ('${directDoc}','${tenant}','${client}','${foreignLoad}',7,'nfe','NF-DIRECT','2026-09-25',
       'Remetente','111','Destinatário','222','issued',now(),now()),
      ('${inboundDoc}','${tenant}','${owner}',null,5,'inbound','NF-IMPORTED','2026-09-24',
       'Remetente','111','Destinatário','222','issued',now(),now()),
      ('${outboundDoc}','${tenant}','${owner}',null,2,'outbound','CT-ISSUED','2026-09-23',
       'Remetente','111','Destinatário','222','issued',now(),now()),
      ('${hiddenDoc}','${tenant}','${owner}',null,1,'nfe','NF-HIDDEN','2026-09-22',
       'Remetente','222','Destinatário','333','issued',now(),now());
  `);
  if (selectedGrant) {
    await db.exec(`create function private.portal_fiscal_visible_for_client(
      _tenant_id uuid,_id uuid,_client_id uuid) returns boolean language sql stable as $$
      select exists(select 1 from public.fiscal_documents fd
        join public.client_portal_access cpa on cpa.tenant_id=fd.tenant_id
          and cpa.client_id=_client_id and cpa.user_id=auth.uid() and cpa.active
        left join public.clients c on c.id=cpa.client_id and c.tenant_id=cpa.tenant_id
        where fd.id=_id and fd.tenant_id=_tenant_id
          and (fd.client_id=cpa.client_id or
            (cpa.access_type='remitter' and c.tax_id=fd.remitter_cnpj)))
    $$;`);
  }
  for (const source of [publishedDocuments, publishedShipments]) {
    const ownerScope = '(_client_id IS NULL OR fd.client_id = _client_id)';
    if (!source.includes(ownerScope)) throw new Error('Published Portal scope changed');
    await db.exec(selectedGrant ? source.replace(ownerScope,
      '(_client_id IS NULL OR private.portal_fiscal_visible_for_client(_tenant_id, fd.id, _client_id))') : source);
  }
  await db.exec(`
    revoke all on function public.list_client_documents_v2(uuid,uuid,text,text,date,date,integer,integer)
      from public, anon;
    revoke all on function public.search_client_portal_shipments_v2(uuid,uuid,text,text[],date,date,text,text,boolean,boolean,integer,integer)
      from public, anon;
    grant execute on function public.list_client_documents_v2(uuid,uuid,text,text,date,date,integer,integer)
      to authenticated;
    grant execute on function public.search_client_portal_shipments_v2(uuid,uuid,text,text[],date,date,text,text,boolean,boolean,integer,integer)
      to authenticated;
  `);
  const metadata = async () => (await db.query(`
    select proname, proacl::text as acl, proconfig::text as config, prosecdef as security_definer
    from pg_proc where pronamespace='public'::regnamespace
      and proname in ('list_client_documents_v2','search_client_portal_shipments_v2')
    order by proname
  `)).rows;
  const beforeRepair = await metadata();
  await db.exec(repair);
  expect(await metadata()).toEqual(beforeRepair);
  return db;
}

let live: PGlite;
let selected: PGlite;
beforeAll(async () => {
  live = await setup(false);
  selected = await setup(true);
}, 30_000);
afterAll(async () => { await live?.close(); await selected?.close(); });

describe('Portal list contracts on published and selected-grant definitions', () => {
  it.each([['published', () => live], ['selected grant', () => selected]] as const)(
    '%s: bounds both SECURITY DEFINER readers', async (_label, getDb) => {
      const db = getDb();
      for (const name of ['list_client_documents_v2', 'search_client_portal_shipments_v2']) {
        for (const invalid of [null, 0, 201]) {
          await expect(db.query(`select public.${name}(_tenant_id=>$1,_limit=>$2)`,
            [tenant, invalid])).rejects.toThrow('portal_invalid_pagination');
        }
        for (const invalid of [null, -1, 1_000_001]) {
          await expect(db.query(`select public.${name}(_tenant_id=>$1,_offset=>$2)`,
            [tenant, invalid])).rejects.toThrow('portal_invalid_pagination');
        }
        await expect(db.query(`select public.${name}(_tenant_id=>$1,_limit=>200,_offset=>1000000)`,
          [tenant])).resolves.toBeDefined();
      }
    });

  it.each([['published', () => live], ['selected grant', () => selected]] as const)(
    '%s: maps fiscal types and hides a foreign-tenant load', async (_label, getDb) => {
      const db = getDb();
      const nfe = await db.query<{ id: string }>(
        'select id from public.list_client_documents_v2(_tenant_id=>$1,_document_type=>$2)', [tenant, 'nfe']);
      const cte = await db.query<{ id: string }>(
        'select id from public.list_client_documents_v2(_tenant_id=>$1,_document_type=>$2)', [tenant, 'cte']);
      expect(nfe.rows.map(row => row.id)).toContain(inboundDoc);
      expect(nfe.rows.map(row => row.id)).not.toContain(hiddenDoc);
      expect(cte.rows).toEqual([{ id: outboundDoc }]);
      const result = await db.query<{ value: { rows: Array<{
        fiscal_document_id: string; volume_count: number; load_number: string | null;
        load_status: string | null; trip_id: string | null; value: number | null;
      }> } }>('select public.search_client_portal_shipments_v2($1) value', [tenant]);
      const row = result.rows[0].value.rows.find(item => item.fiscal_document_id === directDoc);
      expect(row).toMatchObject({ volume_count: 7, load_number: null,
        load_status: null, trip_id: null, value: null });
      expect(result.rows[0].value.rows.map(item => item.fiscal_document_id)).not.toContain(hiddenDoc);
      await expect(db.query('select * from public.list_client_documents_v2($1)', [otherTenant]))
        .rejects.toThrow('portal_forbidden');
    });

  it('keeps the published owner scope and the newer selected-grant scope', async () => {
    const docs = async (db: PGlite) => (await db.query<{ id: string }>(
      'select id from public.list_client_documents_v2(_tenant_id=>$1,_client_id=>$2)',
      [tenant, client])).rows.map(row => row.id);
    expect(await docs(live)).toEqual([directDoc]);
    expect(await docs(selected)).toEqual([directDoc, inboundDoc, outboundDoc]);
    const shipments = async (db: PGlite) => (await db.query<{
      value: { rows: Array<{ fiscal_document_id: string }> }
    }>('select public.search_client_portal_shipments_v2($1,$2) value',
      [tenant, client])).rows[0].value.rows.map(row => row.fiscal_document_id);
    expect(await shipments(live)).toEqual([directDoc]);
    expect(await shipments(selected)).toEqual([directDoc, inboundDoc, outboundDoc]);
  });
});
