import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
export const pollRepair = migration('20260928184134_repair_legacy_cte_poll_audit_event.sql');
export const signature = 'public.commit_legacy_fiscal_poll_v1(jsonb)';
export const ids = Object.fromEntries(['tenant', 'otherTenant', 'document', 'otherDocument', 'emission',
  'otherEmission', 'source', 'otherSource', 'nfse', 'nfseEmission'].map((name, index) =>
  [name, `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));

export async function createPollDatabase() {
  const db = new PGlite();
  try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
    CREATE TABLE public.tenant_memberships(tenant_id uuid,user_id uuid,role text,active boolean);
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
  // Actual versioned table declarations/defaults: no fictional vehicle columns.
  // This deliberately small SQL fixture excludes unrelated application triggers.
  const baseline = migration('20260824224152_baseline.sql');
  const operationType = baseline.match(/CREATE TYPE public\.operation_type AS ENUM \([\s\S]*?\);/)?.[0];
  if (!operationType) throw new Error('Missing historical operation enum');
  await db.exec(operationType);
  for (const table of ['hub_fiscal_emissions', 'fiscal_documents', 'nfse_documents', 'nfse_events', 'vehicle_events', 'entity_audit_log']) {
    const declaration = baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];
    if (!declaration) throw new Error(`Missing historical table ${table}`);
    await db.exec(declaration);
    for (const match of baseline.matchAll(new RegExp(`ALTER TABLE ONLY public\\.${table}\\n    ALTER COLUMN[\\s\\S]*?;`, 'g'))) await db.exec(match[0]);
    await db.exec(`ALTER TABLE public.${table} ADD PRIMARY KEY(id);`);
  }
  const vehicleCheck = baseline.match(/ADD CONSTRAINT vehicle_events_event_type_check[^;]+;/)?.[0];
  if (!vehicleCheck) throw new Error('Missing real telemetry event constraint');
  await db.exec(`ALTER TABLE public.vehicle_events ${vehicleCheck}`);
  const audit = baseline.match(/CREATE OR REPLACE FUNCTION public\._log_entity_audit\([\s\S]*?END \$function\$;/)?.[0];
  if (!audit) throw new Error('Missing real entity audit function');
  await db.exec(audit);
  const historical = migration('20260916231000_finish_reported_integrity_fixes.sql');
  const start = historical.indexOf('create or replace function public.commit_legacy_fiscal_poll_v1(');
  const end = historical.indexOf('grant execute on function public.commit_legacy_fiscal_poll_v1(jsonb) to service_role;', start);
  if (start < 0 || end < 0) throw new Error('Missing complete historical poll function');
  await db.exec(historical.slice(start, end + 'grant execute on function public.commit_legacy_fiscal_poll_v1(jsonb) to service_role;'.length));
  await db.exec(`COMMENT ON FUNCTION ${signature} IS 'Synthetic unrelated metadata marker';
    ALTER FUNCTION ${signature} OWNER TO postgres;`);
  await db.query(`INSERT INTO public.fiscal_documents(id,tenant_id,document_type,status,invoice_number)
    VALUES ($1,$2,'outbound','processing','CTE-QA'),($3,$4,'outbound','processing','CTE-FOREIGN'),
      ($5,$2,'inbound','confirmed','SOURCE-QA'),($6,$4,'inbound','confirmed','SOURCE-FOREIGN')`,
  [ids.document, ids.tenant, ids.otherDocument, ids.otherTenant, ids.source, ids.otherSource]);
  await db.query(`UPDATE public.fiscal_documents SET cte_emitted_outbound_id=$1,cte_emitted_at=now()
    WHERE id=ANY($2::uuid[])`, [ids.document, [ids.source, ids.otherSource]]);
  await db.query(`INSERT INTO public.nfse_documents(id,tenant_id,status,rps_number)
    VALUES ($1,$2,'processing','NFSE-QA')`, [ids.nfse, ids.tenant]);
  await db.query(`INSERT INTO public.hub_fiscal_emissions(id,tenant_id,doc_type,status,fiscal_document_id,nfse_document_id)
    VALUES ($1,$2,'cte','pending',$3,NULL),($4,$5,'cte','pending',$6,NULL),($7,$2,'nfse','pending',NULL,$8)`,
  [ids.emission, ids.tenant, ids.document, ids.otherEmission, ids.otherTenant, ids.otherDocument, ids.nfseEmission, ids.nfse]);
  return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

export function payload(kind = 'cte', outcome = 'authorized') {
  return { tenant_id: ids.tenant, document_kind: kind,
    document_id: kind === 'cte' ? ids.document : ids.nfse,
    emission_id: kind === 'cte' ? ids.emission : ids.nfseEmission,
    emission_patch: { status: outcome, message: `Provider ${outcome}`, last_response: { status: outcome } },
    document_patch: { status: outcome, sefaz_status: outcome, sefaz_message: `Provider ${outcome}`,
      last_status_response: { status: outcome }, status_check_attempts: 3 },
    release_sources: ['rejected', 'cancelled'].includes(outcome),
    event: { event_type: outcome, message: `Polling ${outcome}`, payload: { source: `${kind}-status-poll`, provider: { status: outcome } } } };
}
