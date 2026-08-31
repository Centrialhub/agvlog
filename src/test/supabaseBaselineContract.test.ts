import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migrationsDir = join(root, 'supabase', 'migrations');
const baselinePath = join(migrationsDir, '20260824224152_baseline.sql');
const baseline = readFileSync(baselinePath, 'utf8');
const migrationNames = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
const activeSql = migrationNames.map((name) => readFileSync(join(migrationsDir, name), 'utf8')).join('\n');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return ['.ts', '.tsx', '.js', '.jsx'].includes(extname(entry.name)) ? [path] : [];
  });
}

function sourceText(directory: string, excludedSuffixes: string[] = []): string {
  return sourceFiles(directory)
    .filter((path) => !path.includes(`${join('src', 'test')}${sep}`))
    .filter((path) => !excludedSuffixes.some((suffix) => path.endsWith(suffix)))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
}

function captures(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

function quotedArrays(text: string, name: string): string[] {
  return [...text.matchAll(new RegExp(`${name} constant text\\[\\] := ARRAY\\[(.*?)\\];`, 'gs'))]
    .flatMap((match) => captures(match[1], /'([^']+)'/g));
}

const appSource = sourceText(join(root, 'src'), [
  join('integrations', 'supabase', 'types.ts'),
  'supabaseBaselineContract.test.ts',
]);
const edgeSource = sourceText(join(root, 'supabase', 'functions'));
const cronBootstrap = readFileSync(join(root, 'supabase', 'bootstrap', 'cron_jobs.sql'), 'utf8');
const cronAuthSource = readFileSync(join(root, 'supabase', 'functions', '_shared', 'cron-auth.ts'), 'utf8');
const palletReturnsSource = readFileSync(join(root, 'src', 'hooks', 'usePalletReturns.tsx'), 'utf8');

const tables = new Set(captures(activeSql, /^CREATE TABLE public\.([a-zA-Z0-9_]+)/gim));
const views = new Set(captures(activeSql, /^CREATE(?: OR REPLACE)? VIEW public\.([a-zA-Z0-9_]+)/gim));
const functions = new Set(
  captures(activeSql, /^CREATE(?: OR REPLACE)? FUNCTION public\.([a-zA-Z0-9_]+)\(/gim),
);
const buckets = new Set(captures(activeSql, /INSERT INTO storage\.buckets .*?VALUES \('([^']+)'/g));

const functionGrantStatements = [
  ...activeSql.matchAll(/^GRANT EXECUTE ON FUNCTION\s+([\s\S]*?)\s+TO\s+([^;]+);/gim),
];
const explicitAuthenticatedGrants = functionGrantStatements
  .filter((match) => /\bauthenticated\b/i.test(match[2]))
  .flatMap((match) => captures(match[1], /public\.([a-zA-Z0-9_]+)\(/g));
const explicitServiceGrants = functionGrantStatements
  .filter((match) => /\bservice_role\b/i.test(match[2]))
  .flatMap((match) => captures(match[1], /public\.([a-zA-Z0-9_]+)\(/g));
const internalFunctions = quotedArrays(activeSql, 'internal_only_functions');
const authenticatedFunctions = new Set([
  ...explicitAuthenticatedGrants,
  ...quotedArrays(activeSql, 'frontend_functions'),
]);
internalFunctions.forEach((name) => authenticatedFunctions.delete(name));
const serviceFunctions = new Set(explicitServiceGrants);

describe('Supabase baseline contract', () => {
  it('keeps the immutable baseline followed by ordered forward migrations', () => {
    expect(migrationNames[0]).toBe('20260824224152_baseline.sql');
    expect(migrationNames).toEqual([...migrationNames].sort());
    expect(migrationNames).toContain('20260825161010_restore_frontend_rpc_contract_and_driver_flow.sql');
  });

  it('contains every relation referenced by browser and Edge Function code', () => {
    const referenced = new Set([
      ...captures(appSource, /\.from(?:\s+as\s+any\))?\(\s*['"]([^'"]+)['"]/g),
      ...captures(palletReturnsSource, /\bt\(\s*['"]([^'"]+)['"]/g),
      ...captures(edgeSource, /\.from\(\s*['"]([^'"]+)['"]/g),
    ]);
    const missing = [...referenced].filter(
      (name) => !tables.has(name) && !views.has(name) && !buckets.has(name),
    );
    expect(missing).toEqual([]);
  });

  it('defines and grants every RPC invoked by the browser', () => {
    const invoked = new Set([
      ...captures(appSource, /\.rpc(?:\s+as\s+any\))?\(\s*['"]([^'"]+)['"]/g),
      ...captures(palletReturnsSource, /\brpc\(\s*['"]([^'"]+)['"]/g),
    ]);
    expect([...invoked].filter((name) => !functions.has(name))).toEqual([]);
    expect([...invoked].filter((name) => !authenticatedFunctions.has(name))).toEqual([]);
  });

  it('routes protected load mutations through canonical audited RPCs', () => {
    const canonicalMigration = readFileSync(
      join(migrationsDir, '20260826160000_canonical_load_mutations.sql'),
      'utf8',
    );
    expect(appSource).toContain("rpc('transition_load_status_v1'");
    const browserRpcs = new Set(captures(appSource, /\.rpc\(\s*['"]([^'"]+)['"]/g));
    expect(browserRpcs).toContain('save_load_item_preparation');
    expect(browserRpcs).not.toContain('upsert_load_item_v3');
    const preparationMigration = readFileSync(
      join(migrationsDir, '20260830094049_harden_load_item_preparation_writer.sql'), 'utf8',
    );
    expect(preparationMigration).toContain('v_new_id:=public.upsert_load_item_v3(');
    expect(preparationMigration).toContain('perform public._log_entity_audit(');
    expect(preparationMigration).toContain("'item_preparation'");
    expect(preparationMigration).toContain('item_preparation_expected_changed');
    expect(appSource).toContain("rpc('delete_load_item_v3'");
    expect(appSource).toContain("rpc('assign_fiscal_documents_to_load_v2'");
    expect(appSource).toContain("rpc('remove_fiscal_documents_from_load_v2'");
    expect(appSource).not.toMatch(/from\('load_items'\)[\s\S]{0,120}\.(?:insert|update|delete)\(/);
    expect(canonicalMigration).toContain('REVOKE UPDATE ON public.loads FROM authenticated');
    expect(canonicalMigration).toContain('REVOKE INSERT, UPDATE, DELETE ON public.load_items FROM authenticated');
    expect(canonicalMigration).toContain("'delete_load_item_v1', 'delete_load_item_v2'");
    expect(canonicalMigration).toContain('INSERT INTO public.load_status_history');
    expect(canonicalMigration).toContain("'delete_load_item_v3'");
  });

  it('enforces upload size and MIME limits on private proof buckets', () => {
    const storageMigration = readFileSync(
      join(migrationsDir, '20260826161000_storage_upload_limits.sql'),
      'utf8',
    );
    expect(storageMigration).toContain('file_size_limit = 10485760');
    expect(storageMigration).toContain("'occurrence-return-proofs', 'pallet-return-proofs'");
    expect(storageMigration).toContain("WHERE id = 'receipts'");
    expect(storageMigration).toContain("'application/pdf'");
    expect(storageMigration).toContain("'application/xml'");
  });

  it('keeps integration metadata away from driver and portal roles', () => {
    const integrationPolicyMigration = readFileSync(
      join(migrationsDir, '20260826153408_restrict_integration_metadata_to_operational_roles.sql'),
      'utf8',
    );
    expect(integrationPolicyMigration).toContain('integration_accounts_select_operational');
    expect(integrationPolicyMigration).toContain('hub_fiscal_credentials_select_operational');
    expect(integrationPolicyMigration).toContain('is_tenant_operator_or_admin(tenant_id)');
    expect(integrationPolicyMigration).toContain('is_tenant_admin(tenant_id)');
    expect(integrationPolicyMigration).not.toMatch(/TO\s+public/i);
    expect(integrationPolicyMigration).not.toMatch(/CREATE POLICY\s+"Members read hub creds"/i);
  });

  it('defines and grants every RPC invoked by Edge Functions', () => {
    const invoked = new Set(captures(edgeSource, /\.rpc\(\s*['"]([^'"]+)['"]/g));
    // This endpoint deliberately forwards the user's JWT, not service_role.
    // Its database/Edge integration tests also assert effective ACLs and MFA.
    const callerJwtFunctions = new Set(['evaluate_trip_live_status_v1','prepare_trip_route_v1','commit_trip_route_v1']);
    expect([...invoked].filter((name) => !functions.has(name))).toEqual([]);
    expect([...invoked].filter((name) => !(callerJwtFunctions.has(name)
      ? authenticatedFunctions : serviceFunctions).has(name))).toEqual([]);
    expect([...callerJwtFunctions].filter((name) => !invoked.has(name))).toEqual([]);
    expect([...callerJwtFunctions].filter((name) => serviceFunctions.has(name))).toEqual([]);
    const evaluator = readFileSync(join(root,'supabase','functions','update-trip-live-status','index.ts'),'utf8');
    expect(captures(evaluator,/\.rpc\(\s*['"]([^'"]+)['"]/g)).toEqual(['evaluate_trip_live_status_v1']);
    expect(evaluator).toContain('const supabase=anon;');
    expect(evaluator).toContain('headers: { Authorization: auth }');
    expect(evaluator).toContain('anon.auth.getUser()');
  });

  it('keeps internal SECURITY DEFINER helpers off the browser API', () => {
    expect(internalFunctions.length).toBeGreaterThan(0);
    expect(internalFunctions.filter((name) => authenticatedFunctions.has(name))).toEqual([]);
  });

  it('keeps RLS policy helpers executable while hiding internal helpers from the Data API', () => {
    const privateHelperMigration = readFileSync(
      join(migrationsDir, '20260828105626_hide_driver_rls_helpers_from_data_api.sql'),
      'utf8',
    );
    const policyOnlyHelperMigration = readFileSync(
      join(migrationsDir, '20260828110409_hide_policy_only_driver_helpers_from_data_api.sql'),
      'utf8',
    );

    for (const helper of [
      '_driver_client_ids',
      '_driver_fiscal_document_ids',
      '_driver_load_ids',
      '_driver_order_ids',
      '_driver_pickup_order_ids',
      '_driver_trip_ids',
    ]) {
      expect(privateHelperMigration).toContain(`alter function public.${helper}() set schema private`);
      expect(privateHelperMigration).toContain(`private.${helper}()`);
    }
    for (const helper of ['driver_can_access_vehicle', 'driver_owns_stop']) {
      expect(policyOnlyHelperMigration).toContain(`alter function public.${helper}(uuid) set schema private`);
      expect(policyOnlyHelperMigration).toContain(`private.${helper}`);
    }
    expect(authenticatedFunctions.has('current_driver_id')).toBe(true);
    expect(authenticatedFunctions.has('driver_owns_trip')).toBe(true);
  });

  it('keeps unsafe legacy RPC signatures and policy-only helpers off the Data API', () => {
    const revokeMigration = readFileSync(
      join(migrationsDir, '20260826002800_revoke_unsafe_legacy_rpc_signatures.sql'),
      'utf8',
    );

    for (const helper of [
      '_driver_client_ids',
      '_driver_fiscal_document_ids',
      '_driver_load_ids',
      '_driver_order_ids',
      '_driver_pickup_order_ids',
      '_driver_trip_ids',
    ]) {
      expect(revokeMigration).toContain(
        `revoke execute on function public.${helper}() from public, anon, authenticated`,
      );
    }

    expect(revokeMigration).toMatch(
      /revoke execute on function public\.plan_dispatch_trip_v2\([\s\S]*?uuid\[\],[\s\S]*?timestamptz,[\s\S]*?text[\s\S]*?\) from public, anon, authenticated;/i,
    );
    expect(revokeMigration).toMatch(
      /revoke execute on function public\.upsert_load_item_v1\([\s\S]*?numeric,[\s\S]*?uuid[\s\S]*?\) from public, anon, authenticated;/i,
    );
  });

  it('hardens tenant mutations and the ICMS consistency monitor', () => {
    const hardeningMigration = readFileSync(
      join(migrationsDir, '20260828113034_harden_tenant_mutation_rpcs_and_cte_monitor.sql'),
      'utf8',
    );
    const cteReport = readFileSync(join(root, 'src', 'pages', 'CteConsistencyReport.tsx'), 'utf8');

    for (const rpc of [
      'diagnose_load_composition',
      'repair_load_composition',
      'link_fiscal_documents_to_load_v1',
      'unlink_fiscal_documents_from_load_v1',
    ]) {
      expect(hardeningMigration).toMatch(
        new RegExp(`revoke execute on function public\\.${rpc}\\(`, 'i'),
      );
    }
    expect(hardeningMigration).toContain('public.is_tenant_operator_or_admin(v_s.tenant_id)');
    expect(hardeningMigration).toContain('public.is_tenant_operator_or_admin(_tenant_id)');
    expect(hardeningMigration).toContain('public.is_tenant_admin(_tenant_id)');
    expect(hardeningMigration).toContain("raise exception 'cross_tenant_or_missing_load'");
    expect(hardeningMigration).toContain("raise exception 'Cross-tenant violation: User is not an active tenant member'");
    expect(hardeningMigration).toContain('drop function public.monitor_simples_nacional_icms_violations();');
    expect(cteReport).toContain("_tenant_id: currentTenant.id");
  });

  it('links CT-e batch receivables tenant-safely and idempotently', () => {
    const migration = readFileSync(
      join(migrationsDir, '20260828121520_link_cte_receivables.sql'),
      'utf8',
    );
    const billing = readFileSync(join(root, 'src', 'hooks', 'useBilling.tsx'), 'utf8');

    expect(migration).toContain('add column if not exists cte_document_id uuid');
    expect(migration).toContain('foreign key (tenant_id, cte_document_id)');
    expect(migration).toContain('references public.cte_documents (tenant_id, id)');
    expect(migration).toContain('on delete set null (cte_document_id)');
    expect(migration).toContain('create unique index if not exists receivables_tenant_cte_document_uidx');
    expect(billing).toContain("onConflict: 'tenant_id,cte_document_id'");
    expect(billing).toContain('ignoreDuplicates: true');
    expect(billing).not.toMatch(/net_amount:\s*document\.net_value/);
    expect(billing).not.toMatch(/issue_date:\s*new Date/);
  });

  it('enforces tenant-safe client invoice relationships and source validation', () => {
    const migration = readFileSync(
      join(migrationsDir, '20260828123509_harden_client_invoice_tenant_contract.sql'),
      'utf8',
    );
    const invoiceHook = readFileSync(join(root, 'src', 'hooks', 'useClientInvoices.tsx'), 'utf8');

    expect(migration).toMatch(/foreign key \(tenant_id, client_id\)/i);
    expect(migration).toMatch(/foreign key \(tenant_id, invoice_id\)/i);
    expect(migration).toMatch(/foreign key \(tenant_id, charge_id, invoice_id\)/i);
    expect(migration).toContain("SET search_path TO pg_catalog, public");
    expect(migration).toContain("RAISE EXCEPTION 'client does not belong to tenant'");
    expect(migration).toContain("RAISE EXCEPTION 'CT-e is not eligible for this tenant and client'");
    expect(migration).toContain("RAISE EXCEPTION 'NFS-e is not eligible for this tenant and client'");
    expect(migration).toContain('cte.client_id = v_client');
    expect(migration).toContain('nfse.cliente_id = v_client');
    expect(invoiceHook).toContain(".eq('tenant_id', tenantId)");
    expect(invoiceHook).toContain('items, cancelled, status');
  });

  it('prevents cross-tenant client portal grants', () => {
    const migration = readFileSync(
      join(migrationsDir, '20260828124653_harden_client_portal_access_tenant_contract.sql'),
      'utf8',
    );
    const teamManagement = readFileSync(join(root, 'src', 'pages', 'TeamManagement.tsx'), 'utf8');

    expect(migration).toMatch(/foreign key \(tenant_id, client_id\)/i);
    expect(migration).toContain('REFERENCES public.clients (tenant_id, id)');
    expect(migration).toContain('VALIDATE CONSTRAINT client_portal_access_tenant_client_fkey');
    expect(teamManagement).toContain(".eq('tenant_id', tenantId)");
    expect(teamManagement).not.toMatch(/\bas any\b/);
  });

  it('keeps driver and vehicle assignments tenant-safe in both directions', () => {
    const migration = readFileSync(
      join(migrationsDir, '20260828125152_harden_driver_vehicle_tenant_contract.sql'),
      'utf8',
    );
    const driversPage = readFileSync(join(root, 'src', 'pages', 'Drivers.tsx'), 'utf8');

    expect(migration).toMatch(/foreign key \(tenant_id, current_vehicle_id\)/i);
    expect(migration).toMatch(/foreign key \(tenant_id, current_driver_id\)/i);
    expect(migration).toContain('WHERE tenant_id = NEW.tenant_id');
    expect(migration).toContain('WHERE tenant_id = OLD.tenant_id');
    expect(migration).toContain('SET search_path TO pg_catalog, public');
    expect(driversPage).toContain('vehicles!drivers_tenant_current_vehicle_fkey');
    expect(driversPage).not.toMatch(/\bas any\b/);
  });

  it('keeps closing reports tenant-safe and posts payments to the canonical ledger', () => {
    const migration = readFileSync(
      join(migrationsDir, '20260828130909_harden_closing_report_financial_contract.sql'),
      'utf8',
    );
    const closingHook = readFileSync(join(root, 'src', 'hooks', 'useClosingReports.tsx'), 'utf8');
    const closingPage = readFileSync(join(root, 'src', 'pages', 'ClosingReports.tsx'), 'utf8');

    for (const relation of [
      'public.clients (tenant_id, id)',
      'public.closing_reports (tenant_id, id)',
      'public.client_invoices (tenant_id, id)',
      'public.receivables (tenant_id, id)',
      'public.loads (tenant_id, id)',
      'public.fiscal_documents (tenant_id, id)',
      'public.cte_documents (tenant_id, id)',
      'public.drivers (tenant_id, id)',
      'public.vehicles (tenant_id, id)',
    ]) {
      expect(migration).toContain(`REFERENCES ${relation}`);
    }
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.generate_client_invoice_from_closing(');
    expect(migration).toContain('v_invoice_id := public.create_client_invoice(');
    expect(migration).toContain('PERFORM public.register_receivable_payment(');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.generate_client_invoice_from_closing(uuid)');
    expect(closingHook).not.toContain("rpc('generate_client_invoice_from_closing'");
    expect(closingPage).toContain('ClosingInvoiceCreationDialog reportId={invoiceReport.id} tenantId={invoiceReport.tenant_id}');
    const invoiceHook=readFileSync(join(root,'src','hooks','useClientInvoiceLifecycle.ts'),'utf8');
    expect(invoiceHook).toContain("rpc('get_client_invoice_creation_context'");
    expect(invoiceHook).toContain("rpc('apply_client_invoice_command'");
    expect(closingHook).not.toContain("from('client_invoices').insert");
    expect(closingHook).not.toMatch(/\bas any\b/);
    const financialHook=readFileSync(join(root,'src','hooks','useReceivableFinancial.ts'),'utf8');
    const financialMigration=readFileSync(join(migrationsDir,'20260830183929_audit_receivable_payments_and_reversals.sql'),'utf8');
    expect(closingPage).toContain('receivableId={payDlg.receivable_id} tenantId={payDlg.tenant_id}');
    expect(closingHook).not.toContain("rpc('register_closing_report_payment'");
    expect(financialHook).toContain("rpc('get_receivable_financial_context',{_tenant_id:tenant!,_receivable_id:receivable!})");
    expect(financialHook).toContain("rpc('apply_receivable_financial_command'");
    expect(financialMigration).toContain('financial_invalid_bank_account');
    expect(financialMigration).toContain('receivable_payment_bank_account_tenant_fkey');
    expect(closingPage).not.toMatch(/\bas any\b/);
  });

  it('prevents rural delivery profiles from linking clients across tenants', () => {
    const migration = readFileSync(
      join(migrationsDir, '20260828132140_harden_rural_profile_tenant_contract.sql'),
      'utf8',
    );
    const ruralHook = readFileSync(join(root, 'src', 'hooks', 'useRuralClients.tsx'), 'utf8');

    expect(migration).toContain('FOREIGN KEY (tenant_id, client_id)');
    expect(migration).toContain('FOREIGN KEY (tenant_id, related_remitter_id)');
    expect(migration).toContain('REFERENCES public.clients (tenant_id, id)');
    expect(migration).toContain('ON DELETE SET NULL (related_remitter_id)');
    expect(ruralHook).toContain(".eq('tenant_id', currentTenant.id)");
    expect(ruralHook).not.toMatch(/\bas any\b/);
  });

  it('keeps the DOCCOB profile, export and invoice graph tenant-safe', () => {
    const migration = readFileSync(
      join(migrationsDir, '20260828132852_harden_billing_edi_tenant_contract.sql'),
      'utf8',
    );
    const ediHook = readFileSync(join(root, 'src', 'hooks', 'useBillingEdi.tsx'), 'utf8');
    const ediPage = readFileSync(join(root, 'src', 'pages', 'BillingEdi.tsx'), 'utf8');

    expect(migration).toContain('REFERENCES public.billing_edi_profiles (tenant_id, id)');
    expect(migration).toContain('REFERENCES public.billing_edi_exports (tenant_id, id)');
    expect(migration).toContain('REFERENCES public.client_invoices (tenant_id, id)');
    expect(migration).toContain('REFERENCES public.receivables (tenant_id, id)');
    expect(migration.match(/REFERENCES public.clients \(tenant_id, id\)/g)).toHaveLength(2);
    expect(ediHook).not.toMatch(/\bas any\b/);
    expect(ediPage).not.toMatch(/\bas any\b/);
  });

  it('keeps Hub Fiscal credentials bound to an emitter in the same tenant', () => {
    const migration = readFileSync(
      join(migrationsDir, '20260828133419_harden_hub_credential_tenant_contract.sql'),
      'utf8',
    );
    const emittersHook = readFileSync(join(root, 'src', 'hooks', 'useEmitters.tsx'), 'utf8');
    const emittersPage = readFileSync(join(root, 'src', 'components', 'settings', 'EmittersSettings.tsx'), 'utf8');

    expect(migration).toContain('FOREIGN KEY (tenant_id, emitter_id)');
    expect(migration).toContain('REFERENCES public.tenant_emitters (tenant_id, id)');
    expect(emittersHook).toContain(".eq('tenant_id', currentTenant!.id)");
    expect(emittersPage).not.toMatch(/\bas any\b/);
  });

  it('keeps freight regions bound to clients in the same tenant', () => {
    const migration = readFileSync(
      join(migrationsDir, '20260828133728_harden_client_region_tenant_contract.sql'),
      'utf8',
    );
    const regionsPage = readFileSync(join(root, 'src', 'pages', 'ClientRegions.tsx'), 'utf8');

    expect(migration).toContain('FOREIGN KEY (tenant_id, client_id)');
    expect(migration).toContain('REFERENCES public.clients (tenant_id, id)');
    expect(regionsPage).not.toMatch(/\bas any\b/);
  });

  it('keeps the pallet-return protocol, items and history graph tenant-safe', () => {
    const migration = readFileSync(
      join(migrationsDir, '20260828134845_harden_pallet_return_tenant_contract.sql'),
      'utf8',
    );
    const palletHook = readFileSync(join(root, 'src', 'hooks', 'usePalletReturns.tsx'), 'utf8');
    const palletPage = readFileSync(join(root, 'src', 'pages', 'PalletReturns.tsx'), 'utf8');

    for (const relation of [
      'public.clients (tenant_id, id)',
      'public.drivers (tenant_id, id)',
      'public.vehicles (tenant_id, id)',
      'public.loads (tenant_id, id)',
      'public.pallet_return_protocols (tenant_id, id)',
      'public.pallet_types (tenant_id, id)',
    ]) {
      expect(migration).toContain(`REFERENCES ${relation}`);
    }
    expect(migration).toContain('ON DELETE SET NULL (supplier_id)');
    expect(migration).toContain('ON DELETE SET NULL (pallet_type_id)');
    expect(palletHook).toContain(".eq('tenant_id', currentTenant.id)");
    expect(palletHook).not.toMatch(/\bas any\b/);
    expect(palletPage).not.toMatch(/\bas any\b/);
  });

  it('keeps freight tables bound to clients in the same tenant', () => {
    const migration = readFileSync(
      join(migrationsDir, '20260828140050_harden_freight_table_tenant_contract.sql'),
      'utf8',
    );
    const freightPage = readFileSync(join(root, 'src', 'pages', 'FreightTables.tsx'), 'utf8');

    expect(migration).toContain('FOREIGN KEY (tenant_id, client_id)');
    expect(migration).toContain('REFERENCES public.clients (tenant_id, id)');
    expect(migration).toContain('ON DELETE SET NULL (client_id)');
    expect(freightPage).toContain(".eq('tenant_id', currentTenant.id)");
    expect(freightPage).not.toMatch(/\bas any\b/);
  });

  it('keeps orders bound to clients in the same tenant', () => {
    const migration = readFileSync(
      join(migrationsDir, '20260828141003_harden_order_tenant_contract.sql'),
      'utf8',
    );
    const ordersHook = readFileSync(join(root, 'src', 'hooks', 'useOrders.tsx'), 'utf8');
    const ordersPage = readFileSync(join(root, 'src', 'pages', 'Orders.tsx'), 'utf8');

    expect(migration).toContain('FOREIGN KEY (tenant_id, client_id)');
    expect(migration).toContain('REFERENCES public.clients (tenant_id, id)');
    expect(ordersHook).toContain(".eq('tenant_id', currentTenant.id)");
    expect(ordersHook).not.toMatch(/\bas any\b/);
    expect(ordersPage).not.toMatch(/\bas any\b/);
  });

  it('keeps incidents, responsibles and corrective actions inside their tenant', () => {
    const graphMigration = readFileSync(
      join(migrationsDir, '20260828143144_harden_incident_tenant_contract.sql'),
      'utf8',
    );
    const ownershipMigration = readFileSync(
      join(migrationsDir, '20260828143346_complete_incident_tenant_ownership.sql'),
      'utf8',
    );
    const incidentsHook = readFileSync(join(root, 'src', 'hooks', 'useIncidents.tsx'), 'utf8');

    for (const relation of [
      'public.clients (tenant_id, id)',
      'public.employees (tenant_id, id)',
      'public.drivers (tenant_id, id)',
      'public.vehicles (tenant_id, id)',
      'public.loads (tenant_id, id)',
      'public.orders (tenant_id, id)',
      'public.assets (tenant_id, id)',
      'public.operational_events (tenant_id, id)',
      'public.fiscal_documents (tenant_id, id)',
      'public.dispatch_trips (tenant_id, id)',
      'public.incidents (tenant_id, id)',
    ]) {
      expect(graphMigration).toContain(`REFERENCES ${relation}`);
    }
    expect(ownershipMigration.match(/REFERENCES public\.tenants \(id\)/g)).toHaveLength(2);
    expect(incidentsHook).toContain(".eq('tenant_id', currentTenant.id)");
    expect(incidentsHook).not.toMatch(/\bas any\b/);
  });

  it('keeps CT-e SEFAZ events bound to documents from the same tenant', () => {
    const migration = readFileSync(
      join(migrationsDir, '20260828144026_harden_cte_sefaz_event_tenant_contract.sql'),
      'utf8',
    );
    const monitorHook = readFileSync(join(root, 'src', 'hooks', 'useCteMonitor.tsx'), 'utf8');
    const searchHook = readFileSync(join(root, 'src', 'hooks', 'useCteSearch.tsx'), 'utf8');

    expect(migration).toContain('FOREIGN KEY (tenant_id, cte_document_id)');
    expect(migration).toContain('REFERENCES public.cte_documents (tenant_id, id)');
    expect(migration).toContain('FOREIGN KEY (tenant_id)');
    expect(monitorHook).toContain(".eq('tenant_id', currentTenant.id)");
    expect(monitorHook).not.toMatch(/\bas any\b/);
    expect(searchHook).not.toMatch(/\bas any\b/);
  });

  it('keeps the complete driver-monitoring aggregate tenant-safe', () => {
    const migration = readFileSync(
      join(migrationsDir, '20260828144613_harden_driver_monitoring_tenant_graph.sql'),
      'utf8',
    );
    const indexCleanup = readFileSync(
      join(migrationsDir, '20260828151937_remove_duplicate_driver_monitoring_indexes.sql'),
      'utf8',
    );
    const monitoringHook = readFileSync(join(root, 'src', 'hooks', 'useDriverMonitoring.tsx'), 'utf8');

    for (const relation of [
      'public.drivers (tenant_id, id)',
      'public.vehicles (tenant_id, id)',
      'public.loads (tenant_id, id)',
      'public.driver_monitoring_import_batches (tenant_id, id)',
      'public.driver_route_monitors (tenant_id, id)',
    ]) {
      expect(migration).toContain(`REFERENCES ${relation}`);
    }
    expect(migration.match(/REFERENCES public\.tenants \(id\)/g)).toHaveLength(5);
    expect(indexCleanup.match(/DROP INDEX IF EXISTS/g)).toHaveLength(5);
    expect(monitoringHook).toContain(".eq('tenant_id', tenantId)");
    expect(monitoringHook).not.toMatch(/\bas any\b/);
  });

  it('enforces RLS and security-invoker views', () => {
    const rlsTables = new Set(captures(activeSql, /^ALTER TABLE(?: ONLY)? public\.([a-zA-Z0-9_]+) ENABLE ROW LEVEL SECURITY;/gim));
    expect([...tables].filter((name) => !rlsTables.has(name))).toEqual([]);

    const invokerViews = captures(
      activeSql,
      /^CREATE(?: OR REPLACE)? VIEW public\.([a-zA-Z0-9_]+) WITH\s*\(security_invoker\s*=\s*(?:'true'|true)\)/gim,
    );
    expect(new Set(invokerViews)).toEqual(views);
    expect(baseline).toContain('CREATE EVENT TRIGGER ensure_rls');
  });

  it('uses a least-privilege Data API contract', () => {
    expect(baseline).toContain('Relation privileges: least-privilege Data API contract');
    expect(baseline).toContain('REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role');
    expect(baseline).not.toMatch(
      /^GRANT .*\b(TRUNCATE|REFERENCES|TRIGGER|MAINTAIN)\b.* TO (anon|authenticated);/gm,
    );
    expect(baseline).not.toMatch(/^GRANT .* ON TABLE public\..* TO anon;/gm);
    expect(baseline).toContain("ARRAY['password_encrypted', 'hashauth', 'hashcode', 'token_cache']::text[]");
    expect(baseline).toContain('REVOKE INSERT, UPDATE ON TABLE public.%I FROM authenticated');
    expect(activeSql).toContain("'supabase_admin'::name");
    expect(activeSql).toContain("pg_catalog.pg_has_role(current_user, object_owner, 'MEMBER')");
    expect(activeSql).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public');
  });

  it('does not select backend-only credential columns in browser code', () => {
    const selectArguments = captures(appSource, /\.select\(\s*['"`]([^'"`]*)['"`]/gs).join('\n');
    expect(selectArguments).not.toMatch(
      /secret_ciphertext|password_encrypted|token_cache|credentials_encrypted|credentials_iv|tracker_password/,
    );
  });

  it('preserves sequence ownership and rejects plaintext integration passwords', () => {
    expect(baseline).toContain('OWNED BY public.freight_tables.table_code');
    expect(baseline).toContain('integration_accounts_password_encrypted_format');
    expect(baseline).toContain("password_encrypted LIKE 'enc:v1:%'::text");
  });

  it('indexes every tenant-scoped table and avoids duplicate indexes', () => {
    const tenantTables = [...baseline.matchAll(/^CREATE TABLE public\.([a-zA-Z0-9_]+) \(([\s\S]*?)^\);/gm)]
      .filter((match) => /^\s*tenant_id uuid/m.test(match[2]))
      .map((match) => match[1]);
    const missing = tenantTables.filter((table) => {
      const standalone = new RegExp(
        `^CREATE (?:UNIQUE )?INDEX [^\\r\\n]+ ON public\\.${table} USING [^(]+\\(tenant_id(?:,|\\))`,
        'm',
      ).test(baseline);
      const constraint = new RegExp(
        `^ALTER TABLE ONLY public\\.${table}\\s+[\\s\\S]*?(?:PRIMARY KEY|UNIQUE) \\(tenant_id(?:,|\\))[\\s\\S]*?;`,
        'm',
      ).test(baseline);
      return !standalone && !constraint;
    });
    expect(tenantTables.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);

    const definitions = [...baseline.matchAll(/^CREATE (UNIQUE )?INDEX [^\s]+ (ON public\.[^;]+);/gm)]
      .map((match) => `${match[1] ?? ''}${match[2]}`);
    expect(new Set(definitions).size).toBe(definitions.length);
  });

  it('authorizes fiscal pollers by tenant membership or cron secret', () => {
    for (const name of ['nfse-status-poll', 'cte-status-poll']) {
      const source = readFileSync(join(root, 'supabase', 'functions', name, 'index.ts'), 'utf8');
      expect(source).toContain("req.method !== 'POST'");
      expect(source).toContain('isCronRequest(req, SUPABASE_URL, SERVICE_KEY)');
      expect(source).toContain('authClient.auth.getUser()');
      expect(source).toContain("admin.from('tenant_memberships')");
      expect(source).toContain("['owner', 'admin', 'operator']");
      expect(source).toContain("stoppedReason: 'rate_limited' | 'provider_unavailable' | null");
      expect(source).toContain('stopped_reason: stoppedReason');
    }
    expect(cronAuthSource).toContain('.rpc("verify_agvlog_cron_secret"');
    expect(cronAuthSource).toContain('return !error && data === true');
    expect(cronBootstrap).toContain('vault.decrypted_secrets');
    expect(captures(cronBootstrap, /'x-agvlog-cron-secret'/g)).toHaveLength(5);
  });

  it('fails closed when fiscal webhook secrets are missing', () => {
    const sefaz = readFileSync(join(root, 'supabase', 'functions', 'cte-sefaz-callback', 'index.ts'), 'utf8');
    const hub = readFileSync(join(root, 'supabase', 'functions', 'hub-fiscal-webhook-in', 'index.ts'), 'utf8');
    expect(sefaz).toMatch(/if \(!expectedToken\)[\s\S]*?status: 503/);
    expect(hub).toMatch(/if \(!SHARED_SECRET\)[\s\S]*?status: 503/);
  });

  it('claims fiscal callbacks durably and idempotently before applying them', () => {
    const claimMigration = readFileSync(
      join(migrationsDir, '20260826163000_fiscal_webhook_inbox_claims.sql'),
      'utf8',
    );
    const sefaz = readFileSync(join(root, 'supabase', 'functions', 'cte-sefaz-callback', 'index.ts'), 'utf8');
    const hub = readFileSync(join(root, 'supabase', 'functions', 'hub-fiscal-webhook-in', 'index.ts'), 'utf8');

    expect(claimMigration).toContain('ON CONFLICT (delivery_id) DO NOTHING');
    expect(claimMigration).toContain("v_updated_at > v_now - interval '5 minutes'");
    expect(claimMigration).toContain("WHEN attempt_count >= 8 THEN 'dead_lettered'");
    expect(claimMigration).toContain('WHEN p_success OR attempt_count >= 8 THEN NULL');
    expect(claimMigration).toContain('WHEN p_success THEN NULL');
    expect(claimMigration).toContain('uq_cte_sefaz_events_delivery_id');
    expect(claimMigration).toContain('complete_fiscal_webhook_delivery_v1');
    expect(serviceFunctions).toContain('claim_fiscal_webhook_delivery_v1');
    expect(serviceFunctions).toContain('complete_fiscal_webhook_delivery_v1');
    expect(authenticatedFunctions).not.toContain('claim_fiscal_webhook_delivery_v1');
    expect(authenticatedFunctions).not.toContain('complete_fiscal_webhook_delivery_v1');

    for (const source of [sefaz, hub]) {
      expect(source).toContain('claimFiscalWebhook({');
      expect(source).toContain('completeFiscalWebhook(');
    }
    expect(hub).not.toContain('success: true, matched: false');
    expect(hub).toContain("error: 'document_not_found'");
    expect(sefaz).toContain("eventError.code !== '23505'");
  });

  it('restores privileged MFA forward-only after the historical rollback', () => {
    const legacyMfaMigration = readFileSync(
      join(migrationsDir, '20260826165000_require_privileged_mfa.sql'),
      'utf8',
    );
    const removalMigration = readFileSync(
      join(migrationsDir, '20260828160000_remove_privileged_mfa.sql'),
      'utf8',
    );
    const releaseMfaMigration = readFileSync(
      join(migrationsDir, '20260828210458_enforce_privileged_mfa_release.sql'),
      'utf8',
    );

    for (const helper of [
      'get_user_tenant_ids',
      'has_tenant_role',
      'is_tenant_member',
      'is_tenant_admin',
      'is_tenant_operator_or_admin',
      'get_user_portal_tenants',
    ]) {
      expect(removalMigration.toLowerCase()).toContain(`function public.${helper}(`);
    }
    expect(removalMigration).toContain(
      'drop function if exists public.session_has_privileged_mfa_v1(uuid)',
    );
    expect(removalMigration).toContain('membership.user_id = auth.uid()');
    expect(removalMigration).toContain("membership.role::text in ('owner', 'admin')");
    expect(removalMigration).toContain("membership.role::text in ('owner', 'admin', 'operator')");
    expect(removalMigration).not.toMatch(/auth\.jwt|aal1|aal2/i);

    for (const helper of [
      'get_user_tenant_ids',
      'has_tenant_role',
      'is_tenant_member',
      'is_tenant_admin',
      'is_tenant_operator_or_admin',
      'get_user_portal_tenants',
    ]) {
      expect(releaseMfaMigration.toLowerCase()).toContain(`function public.${helper}(`);
    }
    expect(releaseMfaMigration).toContain("coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'");
    expect(releaseMfaMigration).toContain('revoke all on function public.session_has_privileged_mfa_v1(uuid) from public, anon, authenticated');

    // The historical migration also removed permissive policy overlaps. Those
    // tenant-isolation changes remain part of the active database contract.
    for (const table of ['hub_fiscal_credentials', 'hub_fiscal_emissions', 'load_manifests']) {
      expect(legacyMfaMigration).toContain(`DROP POLICY IF EXISTS agvlog_select_authenticated ON public.${table}`);
      expect(legacyMfaMigration).toContain(`DROP POLICY IF EXISTS agvlog_insert_authenticated ON public.${table}`);
      expect(legacyMfaMigration).toContain(`DROP POLICY IF EXISTS agvlog_update_authenticated ON public.${table}`);
      expect(legacyMfaMigration).toContain(`DROP POLICY IF EXISTS agvlog_delete_authenticated ON public.${table}`);
    }
    expect(legacyMfaMigration).toContain('GRANT EXECUTE ON FUNCTION public.get_current_memberships_v1() TO authenticated');
    expect(legacyMfaMigration).not.toContain('CREATE POLICY "Users can view own membership for MFA bootstrap"');
    expect(appSource).toContain("rpc('get_current_memberships_v1')");
    expect(legacyMfaMigration).toContain('DROP POLICY IF EXISTS "Tenant isolation" ON public.tenant_emitters');
    expect(legacyMfaMigration).toContain('public.is_tenant_member(((storage.foldername(name))[1])::uuid)');
  });

  it('removes permissive RLS overlaps that would widen privileged tables', () => {
    const overlapMigration = readFileSync(
      join(migrationsDir, '20260826171000_remove_permissive_policy_overlaps.sql'),
      'utf8',
    );

    for (const table of [
      'driver_settlement_loads',
      'integration_accounts',
      'operational_event_messages',
      'payables_payments',
      'receivables_payments',
      'tenant_emitters',
    ]) {
      expect(overlapMigration).toContain(`ON public.${table}`);
      expect(overlapMigration).toContain('agvlog_select_authenticated');
    }

    for (const table of ['integration_accounts', 'payables_payments', 'receivables_payments', 'tenant_emitters']) {
      expect(overlapMigration).toContain(`DROP POLICY IF EXISTS agvlog_insert_authenticated ON public.${table}`);
      expect(overlapMigration).toContain(`DROP POLICY IF EXISTS agvlog_update_authenticated ON public.${table}`);
      expect(overlapMigration).toContain(`DROP POLICY IF EXISTS agvlog_delete_authenticated ON public.${table}`);
    }

    expect(overlapMigration).toContain('CREATE POLICY "Operational roles manage hub fiscal emissions"');
    expect(overlapMigration).toContain('CREATE POLICY "Operational roles manage payable payments"');
    expect(overlapMigration).toContain('CREATE POLICY "Operational roles manage receivable payments"');
  });

  it('restores guarded authenticated RPC access for the client portal', () => {
    const portalMigration = readFileSync(
      join(migrationsDir, '20260826170000_harden_portal_rpc_execution.sql'),
      'utf8',
    );
    const podSigner = readFileSync(
      join(root, 'supabase', 'functions', 'get-client-pod-signed-url', 'index.ts'),
      'utf8',
    );

    for (const rpc of [
      'get_client_portal_summary_v2',
      'list_client_documents_v2',
      'list_client_pods_v2',
      'list_client_pickups_v2',
      'list_client_occurrences_v2',
      'search_client_portal_shipments_v2',
      'get_client_portal_reports_summary_v2',
      'get_client_portal_alerts_v2',
      'get_client_portal_upcoming_deliveries_v2',
      'get_client_portal_tracking_v2',
    ]) {
      expect(portalMigration).toContain(`FUNCTION public.${rpc}(`);
    }
    expect(portalMigration.match(/TO authenticated, service_role;/g)).toHaveLength(11);
    expect(portalMigration).toContain('CREATE OR REPLACE FUNCTION public.log_pod_access_v2(');
    expect(portalMigration).toContain('access.can_download_documents');
    expect(portalMigration).toContain('TO service_role;');
    expect(portalMigration).toContain('FROM PUBLIC, anon, authenticated;');
    expect(podSigner).toContain("'get_client_pod_metadata'");
    expect(podSigner).toContain("admin.rpc('log_pod_access_v2'");
    expect(podSigner).not.toContain("'portal_user_can_download_fiscal_document'");
    expect(podSigner.indexOf("'get_client_pod_metadata'")).toBeLessThan(
      podSigner.indexOf("createClient(url, serviceKey)"),
    );
  });
});
