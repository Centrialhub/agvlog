import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const readMigration = (filename) => readFileSync(new URL(`../supabase/migrations/${filename}`, import.meta.url), 'utf8');
export const ordinalityPatch = readMigration('20260928183014_fix_active_json_ordinality_contracts.sql');
export const signatures = [
  'public.edit_pallet_return_protocol_v1(jsonb)',
  'public.get_finance_account_period_evidence_page(uuid,uuid,uuid,integer,integer,integer)',
];
export const ids = Object.fromEntries(['tenant', 'foreignTenant', 'actor', 'foreignActor', 'protocol', 'foreignProtocol',
  'account', 'foreignAccount', 'closure', 'foreignClosure'].map((key, index) => [key, `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));
export const movements = [
  { id: 'z-last-alphabetically', amount_cents: '500', receipt_path: 'test/one.pdf' },
  { id: 'a-first-alphabetically', amount_cents: '-200', receipt_path: null },
  { id: 'middle', amount_cents: '300', receipt_path: '   ' },
  { id: 'fourth', amount_cents: '400', receipt_path: 'test/four.pdf' },
  { id: 'fifth', amount_cents: '100', receipt_path: 'test/five.pdf' },
];
export const dependencies = [
  { source_kind: 'receivable', source_id: 'z9', revision: 'r3' },
  { source_kind: 'payable', source_id: 'z2', revision: 'r1' },
  { source_kind: 'receivable', source_id: 'a1', revision: 'r2' },
  { source_kind: 'payable', source_id: 'a0', revision: 'r4' },
];

// Executes complete historical RPCs + receipt hotfix, or captured baseline RPCs.
// Supporting tables and membership helpers are intentionally minimal; this suite
// validates these RPC contracts, not the full Supabase/RLS application boundary.
export async function createOrdinalityDatabase({ source = 'historical' } = {}) {
  if (!['historical', 'captured'].includes(source)) throw new Error('Unknown ordinality fixture source');
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA finance_private;
    CREATE TABLE public.qa_memberships(tenant_id uuid, user_id uuid, active boolean, role text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION public.is_tenant_operator_or_admin(tenant uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT EXISTS(SELECT 1 FROM public.qa_memberships WHERE tenant_id=tenant AND user_id=auth.uid() AND active AND role IN ('operator','admin')) $$;
    CREATE FUNCTION finance_private.can_access(tenant uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT public.is_tenant_operator_or_admin(tenant) $$;
    GRANT USAGE ON SCHEMA public,auth,finance_private TO authenticated;
    GRANT SELECT ON public.qa_memberships TO authenticated;
    CREATE TABLE public.pallet_return_protocols(id uuid PRIMARY KEY,tenant_id uuid,status text,
      supplier_name_snapshot text,issue_date date,returned_at date,driver_name_snapshot text,
      vehicle_plate_snapshot text,notes text,total_quantity integer,updated_at timestamptz,updated_by uuid);
    CREATE TABLE public.pallet_return_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,
      protocol_id uuid,pallet_type_id uuid,pallet_type_code text,pallet_type_name text,pallet_color text,
      quantity integer,notes text,sort_order integer);
    CREATE TABLE public.pallet_return_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,
      protocol_id uuid,action text,reason text,metadata jsonb,created_by uuid);
    GRANT SELECT,UPDATE ON public.pallet_return_protocols TO authenticated;
    GRANT SELECT,INSERT,DELETE ON public.pallet_return_items TO authenticated;
    GRANT INSERT ON public.pallet_return_history TO authenticated;
    CREATE TABLE public.finance_account_period_closures(id uuid PRIMARY KEY,tenant_id uuid,account_id uuid,
      period_start date,period_end date,snapshot_revision text,actor_id uuid,actor_name text,reason text,
      created_at timestamptz,snapshot jsonb);
    CREATE TABLE public.finance_account_period_reopenings(id uuid PRIMARY KEY,tenant_id uuid,closure_id uuid,
      actor_id uuid,actor_name text,reason text,created_at timestamptz);
    CREATE TABLE public.finance_account_period_dependencies(tenant_id uuid,closure_id uuid,
      source_kind text,source_id text,revision text);
    INSERT INTO public.qa_memberships VALUES
      ('${ids.tenant}','${ids.actor}',true,'operator'),('${ids.foreignTenant}','${ids.foreignActor}',true,'operator');
    INSERT INTO public.pallet_return_protocols(id,tenant_id,status,supplier_name_snapshot,total_quantity) VALUES
      ('${ids.protocol}','${ids.tenant}','draft','Original supplier',9),
      ('${ids.foreignProtocol}','${ids.foreignTenant}','draft','Foreign supplier',7);
    INSERT INTO public.pallet_return_items(tenant_id,protocol_id,pallet_type_code,quantity,sort_order) VALUES
      ('${ids.tenant}','${ids.protocol}','OLD',9,0),('${ids.foreignTenant}','${ids.foreignProtocol}','FOREIGN',7,0);
  `);
  await db.exec(readMigration('20260922019000_require_whole_pallet_edit_quantities.sql'));
  const history = readMigration('20260917151500_bound_account_period_evidence_history.sql');
  const end = history.indexOf('end$$;');
  if (end < 0) throw new Error('Complete evidence-page historical function not found');
  await db.exec(history.slice(0, end + 'end$$;'.length));
  await db.exec(readMigration('20260922038000_summarize_full_period_movement_receipts.sql'));
  if (source === 'captured') {
    for (const filename of ['pallet-edit-captured-2026-09-28.sql', 'finance-period-evidence-captured-2026-09-28.sql']) {
      await db.exec(readFileSync(new URL(`./fixtures/${filename}`, import.meta.url), 'utf8'));
    }
  }
  await db.exec(`REVOKE ALL ON FUNCTION ${signatures[1]} FROM PUBLIC,anon,authenticated,service_role;
    GRANT EXECUTE ON FUNCTION ${signatures[1]} TO authenticated;
    COMMENT ON FUNCTION ${signatures[0]} IS 'Synthetic metadata preservation marker';`);
  const snapshot = { facts: { movements, movement_total_cents: '1100' }, balances: { opening_cents: '2000', closing_cents: '3100' }, dependencies };
  for (const tenant of ['local', 'foreign']) {
    const foreign = tenant === 'foreign';
    await db.query(`INSERT INTO public.finance_account_period_closures(id,tenant_id,account_id,period_start,period_end,
      actor_id,actor_name,reason,created_at,snapshot) VALUES($1,$2,$3,'2026-09-01','2026-09-30',$4,'Synthetic actor','test','2026-09-28T00:00:00Z',$5)`,
    [foreign ? ids.foreignClosure : ids.closure, foreign ? ids.foreignTenant : ids.tenant,
      foreign ? ids.foreignAccount : ids.account, foreign ? ids.foreignActor : ids.actor, snapshot]);
    for (const dependency of dependencies) await db.query('INSERT INTO public.finance_account_period_dependencies VALUES($1,$2,$3,$4,$5)',
      [foreign ? ids.foreignTenant : ids.tenant, foreign ? ids.foreignClosure : ids.closure,
        dependency.source_kind, dependency.source_id, dependency.revision]);
  }
  await db.exec(`UPDATE public.finance_account_period_closures SET snapshot_revision=md5(snapshot::text),
    snapshot=snapshot||jsonb_build_object('revision',md5(snapshot::text));`);
  return db;
}
