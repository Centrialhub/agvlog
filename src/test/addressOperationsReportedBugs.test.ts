import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseQueue } from '@/pages/AddressResolution';

const addressSource = readFileSync('src/pages/AddressResolution.tsx', 'utf8');
const fiscalSource = readFileSync('src/pages/FiscalDocuments.tsx', 'utf8');
const fiscalHook = readFileSync('src/hooks/useFiscalDocuments.tsx', 'utf8');
const operationsSource = readFileSync('src/pages/OperationsCenter.tsx', 'utf8');
const operationsKpiSource = readFileSync('src/components/operations/OperationsCenterKpis.tsx', 'utf8');
const addressMigration = readFileSync('supabase/migrations/20260917130000_page_active_address_resolution_queue.sql', 'utf8');
const stableAddressMigration = readFileSync('supabase/migrations/20260917135500_stabilize_address_resolution_pagination.sql', 'utf8');
const reactivationSafeMigration = readFileSync('supabase/migrations/20260917143700_snapshot_address_queue_by_update.sql', 'utf8');
const deadlineMigration = readFileSync('supabase/migrations/20260917130500_operational_load_deadlines.sql', 'utf8');
const stableFiscalMigration = readFileSync('supabase/migrations/20260917143800_stabilize_fiscal_document_paging.sql', 'utf8');
const literalFiscalSearchMigration = readFileSync('supabase/migrations/20260917143900_fix_fiscal_document_literal_search.sql', 'utf8');

describe('reported catalog, address queue and operations regressions', () => {
  it('blocks fiscal creation while either catalog is unavailable', () => {
    expect(fiscalSource).toContain('clientsQuery.isError || ordersQuery.isError');
    expect(fiscalSource).toContain('catalogsLoading || catalogsError');
    expect(fiscalSource).toContain('onRetryCatalogs');
  });

  it('filters actionable address states before paging and returns exact counts', () => {
    expect(addressSource).toContain("rpc('get_active_address_resolution_queue_v2'");
    expect(addressMigration).toContain("r.status in ('pending','ambiguous','error')");
    expect(addressMigration).toContain("count(*) filter(where status='pending')");
    expect(addressSource).toContain('Paginação da fila de endereços');
  });

  it('never displays an all-resolved success state after a query failure', () => {
    expect(addressSource).toContain('queue.isSuccess && totalCount === 0');
    expect(addressSource).not.toContain('!queue.isLoading && items.length === 0');
  });

  it('rejects a partially incompatible queue instead of silently dropping rows', () => {
    const valid = {
      id: 'queue', entity_id: 'client', entity_type: 'client', address_snapshot: 'Rua 1',
      status: 'pending', candidates: [], attempts: 0, company_name: 'Cliente',
    };
    expect(() => parseQueue([valid, { ...valid, id: null }])).toThrow(/Item 2/);
    expect(parseQueue([valid])).toHaveLength(1);
  });

  it('uses an immutable keyset and first-page snapshot for the mutable address queue', () => {
    expect(stableAddressMigration).toContain('r.created_at <= v_snapshot_at');
    expect(stableAddressMigration).toContain('(created_at,id) > (_cursor_created_at,_cursor_id)');
    expect(stableAddressMigration).toContain('order by created_at,id');
    expect(stableAddressMigration).not.toContain('offset _page_offset');
    expect(addressSource).toContain('_snapshot_at: snapshotRef.current');
    expect(addressSource).toContain('_cursor_updated_at: cursor?.createdAt');
  });

  it('keeps reactivated rows outside an in-progress snapshot and restarts pagination after mutations', () => {
    expect(reactivationSafeMigration).toContain('r.updated_at <= v_snapshot_at');
    expect(reactivationSafeMigration).toContain('(updated_at,id) > (_cursor_updated_at,_cursor_id)');
    expect(reactivationSafeMigration).toContain('address_resolution_queue_active_updated_cursor');
    expect(addressSource).toContain('_cursor_updated_at: cursor?.createdAt');
    expect(addressSource.match(/restartQueue\(\);/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('derives overdue loads from operational deadlines, never from updated_at', () => {
    expect(operationsSource).toContain("rpc('get_operations_load_counts_v1'");
    expect(operationsSource).not.toContain(".lt('updated_at'");
    expect(deadlineMigration).toContain('estimated_arrival_at');
    expect(deadlineMigration).toContain('scheduled_load_at');
    expect(operationsKpiSource).toContain('Fora do prazo operacional');
  });

  it('excludes soft-deleted fiscal documents from operations KPIs', () => {
    expect(operationsSource).toContain(".is('deleted_at', null)");
  });

  it('keyset-pages fiscal documents and rejects a changed later page',()=>{
    expect(stableFiscalMigration).toContain('(f.created_at,f.id)<(_cursor_created_at,_cursor_id)');
    expect(stableFiscalMigration).toContain("raise exception 'fiscal_document_list_changed'");
    expect(stableFiscalMigration).toContain('bump_fiscal_document_list_revision');
    expect(stableFiscalMigration).not.toContain('offset _page_offset');
    expect(fiscalHook).toContain('FiscalDocumentListChangedError');
    expect(fiscalSource).toContain('error instanceof FiscalDocumentListChangedError');
  });

  it('preserves fiscal search punctuation and escapes SQL wildcard characters', () => {
    expect(fiscalHook).toContain('const normalizedSearch = search.trim()');
    expect(fiscalHook).not.toContain('safePostgrestSearch');
    expect(literalFiscalSearchMigration).toContain("replace(v_search,chr(92),chr(92)||chr(92))");
    expect(literalFiscalSearchMigration).toContain("'%',chr(92)||'%'");
    expect(literalFiscalSearchMigration).toContain("'_',chr(92)||'_'");
    expect(literalFiscalSearchMigration).toContain("ilike v_search_pattern escape E'\\\\'");
  });
});
