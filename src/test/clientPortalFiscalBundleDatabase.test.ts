// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260916152230_client_portal_fiscal_bundle_and_titles.sql',
  'utf8',
);

const ids = {
  tenant: '20000000-0000-4000-8000-000000000001',
  user: '10000000-0000-4000-8000-000000000001',
  otherUser: '10000000-0000-4000-8000-000000000002',
  client: '30000000-0000-4000-8000-000000000001',
  otherClient: '30000000-0000-4000-8000-000000000002',
  note: '90000000-0000-4000-8000-000000000001',
  otherNote: '90000000-0000-4000-8000-000000000002',
  load: '80000000-0000-4000-8000-000000000001',
  cte: 'a0000000-0000-4000-8000-000000000001',
  nfse: 'b0000000-0000-4000-8000-000000000001',
  title: 'c0000000-0000-4000-8000-000000000001',
  invoice: 'd0000000-0000-4000-8000-000000000001',
};

let db: PGlite;

async function actor(userId: string | null) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId || '']);
}

async function rpc<T>(sql: string, params: unknown[]) {
  await db.exec('set role authenticated');
  try {
    const result = await db.query<{ result: T }>(sql, params);
    await db.exec('reset role');
    return result.rows[0].result;
  } catch (error) {
    await db.exec('reset role');
    throw error;
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;

    create table clients(
      id uuid primary key, tenant_id uuid not null, company_name text not null, tax_id text
    );
    create table client_portal_access(
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null, user_id uuid not null,
      client_id uuid not null, access_type text not null, active boolean not null,
      can_view_financial boolean not null default false,
      can_download_documents boolean not null default false
    );
    create table fiscal_documents(
      id uuid primary key, tenant_id uuid not null, client_id uuid, load_id uuid,
      remitter_cnpj text, recipient_cnpj text, deleted_at timestamptz
    );
    create table cte_documents(
      id uuid primary key, tenant_id uuid not null, status text not null,
      cancelled_at timestamptz, is_voided boolean not null default false,
      fiscal_document_ids uuid[], issued_at timestamptz, cte_number text,
      reference_number text, internal_number text, cte_series text, remitter text,
      recipient text, freight_value numeric, pdf_url text, xml_url text, xml_content text
    );
    create table nfse_documents(
      id uuid primary key, tenant_id uuid not null, status text not null,
      cancelled boolean not null default false, is_preview boolean not null default false,
      fiscal_document_ids uuid[], related_cte_ids uuid[], authorization_date timestamptz,
      issue_date date, nfse_number text, invoice_number text, rps_number text,
      series text, prestador_cnpj text, cliente_nome text, valor_total numeric,
      pdf_url text, xml_url text
    );
    create table receivables(
      id uuid primary key, tenant_id uuid not null, client_id uuid, fiscal_document_id uuid,
      load_id uuid, description text, invoice_number text, amount numeric not null,
      received_amount numeric, due_date date, status text not null, received_at timestamptz,
      client_invoice_id uuid
    );
    create table client_invoices(
      id uuid primary key, tenant_id uuid not null, receivable_id uuid, invoice_number text,
      issue_date date, due_date date, status text, total_amount numeric,
      pdf_url text, created_at timestamptz not null default now()
    );

    create function portal_user_can_access_fiscal_document(_tenant_id uuid,_fiscal_document_id uuid)
    returns boolean language sql stable security definer set search_path=''
    as $$select exists(
      select 1 from public.fiscal_documents fd
      join public.client_portal_access cpa on cpa.tenant_id=fd.tenant_id
       and cpa.user_id=auth.uid() and cpa.active
      where fd.id=_fiscal_document_id and fd.tenant_id=_tenant_id and fd.deleted_at is null
       and cpa.client_id=fd.client_id
    )$$;
    create function portal_user_can_view_financial(_tenant_id uuid,_fiscal_document_id uuid)
    returns boolean language sql stable security definer set search_path=''
    as $$select exists(
      select 1 from public.fiscal_documents fd
      join public.client_portal_access cpa on cpa.tenant_id=fd.tenant_id
       and cpa.user_id=auth.uid() and cpa.active and cpa.can_view_financial
      where fd.id=_fiscal_document_id and fd.tenant_id=_tenant_id and cpa.client_id=fd.client_id
    )$$;
    create function portal_user_can_download_fiscal_document(_tenant_id uuid,_fiscal_document_id uuid)
    returns boolean language sql stable security definer set search_path=''
    as $$select exists(
      select 1 from public.fiscal_documents fd
      join public.client_portal_access cpa on cpa.tenant_id=fd.tenant_id
       and cpa.user_id=auth.uid() and cpa.active and cpa.can_download_documents
      where fd.id=_fiscal_document_id and fd.tenant_id=_tenant_id and cpa.client_id=fd.client_id
    )$$;
  `);

  await db.exec(migration);
  await db.query(
    "insert into clients values($1,$2,'Cliente A','001'),($3,$2,'Cliente B','002')",
    [ids.client, ids.tenant, ids.otherClient],
  );
  await db.query(
    "insert into client_portal_access(tenant_id,user_id,client_id,access_type,active) values($1,$2,$3,'viewer',true)",
    [ids.tenant, ids.user, ids.client],
  );
  await db.query(
    'insert into fiscal_documents values($1,$2,$3,$4,null,null,null),($5,$2,$6,$4,null,null,null)',
    [ids.note, ids.tenant, ids.client, ids.load, ids.otherNote, ids.otherClient],
  );
  await db.query(
    "insert into cte_documents values($1,$2,'authorized',null,false,array[$3]::uuid[],'2026-09-16T12:00:00Z','7001',null,null,'1','Emitente','Cliente A',180,'https://files.test/cte.pdf',null,'<cte/>')",
    [ids.cte, ids.tenant, ids.note],
  );
  await db.query(
    "insert into nfse_documents values($1,$2,'issued',false,false,array[$3]::uuid[],array[$4]::uuid[],'2026-09-16T13:00:00Z','2026-09-16','8001',null,'RPS-1','1','009','Cliente A',180,null,'https://files.test/nfse.xml')",
    [ids.nfse, ids.tenant, ids.note, ids.cte],
  );
  await db.query(
    "insert into receivables values($1,$2,$3,$4,$5,'Frete NF 101','T-101',180,30,'2026-09-30','partial',null,$6)",
    [ids.title, ids.tenant, ids.client, ids.note, ids.load, ids.invoice],
  );
  await db.query(
    "insert into client_invoices values($1,$2,$3,'FAT-101','2026-09-16','2026-09-30','generated',180,'https://files.test/title.pdf',now())",
    [ids.invoice, ids.tenant, ids.title],
  );
}, 30_000);

afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('update client_portal_access set active=true,can_view_financial=false,can_download_documents=false');
  await actor(ids.user);
});

describe('client portal fiscal bundle and titles SQL boundary', () => {
  it('lists only linked CT-e/NFS-e metadata without leaking file URLs or financial values', async () => {
    const bundle = await rpc<Record<string, unknown>>(
      'select public.portal_list_fiscal_bundle($1,$2) result',
      [ids.tenant, ids.note],
    );
    expect(bundle.can_download_documents).toBe(false);
    expect((bundle.documents as Array<Record<string, unknown>>).map((item) => item.kind)).toEqual(['nfse', 'cte']);
    expect(JSON.stringify(bundle)).not.toContain('files.test');
    expect(JSON.stringify(bundle)).not.toContain('<cte/>');
    expect((bundle.documents as Array<Record<string, unknown>>).every((item) => item.amount === null)).toBe(true);
  });

  it('requires download permission and returns only the requested authorized file', async () => {
    await expect(rpc('select public.portal_get_fiscal_file($1,$2,$3,$4,$5) result', [ids.tenant, ids.note, 'cte', ids.cte, 'xml']))
      .rejects.toThrow('download_not_allowed');
    await db.exec('update client_portal_access set can_download_documents=true');
    const file = await rpc<Record<string, unknown>>(
      'select public.portal_get_fiscal_file($1,$2,$3,$4,$5) result',
      [ids.tenant, ids.note, 'cte', ids.cte, 'xml'],
    );
    expect(file).toMatchObject({ source: 'inline', content: '<cte/>', document_id: ids.cte });
    await expect(rpc('select public.portal_get_fiscal_file($1,$2,$3,$4,$5) result', [ids.tenant, ids.otherNote, 'cte', ids.cte, 'xml']))
      .rejects.toThrow('not_authorized');
  });

  it('hides titles without financial permission and exposes exact balances when granted', async () => {
    let titles = await rpc<{ rows: unknown[]; total: number }>(
      'select public.portal_list_financial_titles($1,$2,null,50,0) result',
      [ids.tenant, ids.client],
    );
    expect(titles).toMatchObject({ rows: [], total: 0 });
    await db.exec('update client_portal_access set can_view_financial=true');
    titles = await rpc('select public.portal_list_financial_titles($1,$2,null,50,0) result', [ids.tenant, ids.client]);
    expect(titles.total).toBe(1);
    expect(titles.rows[0]).toMatchObject({ invoice_number: 'FAT-101', amount: 180, received_amount: 30, outstanding_amount: 150, has_pdf: true, can_download: false });
  });

  it('downloads a title PDF only when both financial and document permissions are active', async () => {
    await db.exec('update client_portal_access set can_view_financial=true');
    await expect(rpc('select public.portal_get_financial_title_file($1,$2) result', [ids.tenant, ids.title]))
      .rejects.toThrow('file_not_available');
    await db.exec('update client_portal_access set can_download_documents=true');
    const file = await rpc<Record<string, unknown>>(
      'select public.portal_get_financial_title_file($1,$2) result',
      [ids.tenant, ids.title],
    );
    expect(file).toMatchObject({ source: 'url', url: 'https://files.test/title.pdf' });
  });

  it('fails closed for a revoked or different portal actor', async () => {
    await actor(ids.otherUser);
    await expect(rpc('select public.portal_list_fiscal_bundle($1,$2) result', [ids.tenant, ids.note]))
      .rejects.toThrow('not_authorized');
    await actor(ids.user);
    await db.exec('update client_portal_access set active=false');
    await expect(rpc('select public.portal_list_fiscal_bundle($1,$2) result', [ids.tenant, ids.note]))
      .rejects.toThrow('not_authorized');
  });

  it('keeps privileged helpers outside the Data API and grants only authenticated wrappers', async () => {
    const acl = (await db.query<Record<string, boolean>>(`select
      has_function_privilege('anon','public.portal_list_fiscal_bundle(uuid,uuid)','execute') list_anon,
      has_function_privilege('authenticated','public.portal_list_fiscal_bundle(uuid,uuid)','execute') list_auth,
      has_function_privilege('service_role','public.portal_list_fiscal_bundle(uuid,uuid)','execute') list_service,
      has_schema_privilege('anon','private','usage') private_anon,
      has_schema_privilege('authenticated','private','usage') private_auth
    `)).rows[0];
    expect(acl).toEqual({ list_anon: false, list_auth: true, list_service: false, private_anon: false, private_auth: true });
  });
});
