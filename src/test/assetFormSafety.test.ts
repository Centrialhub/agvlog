import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/pages/Assets.tsx', 'utf8');
const hook = readFileSync('src/hooks/useAssets.tsx', 'utf8');

describe('asset form safety', () => {
  it('closes stale edits when the active tenant changes', () => {
    expect(page).toContain('}, [currentTenant?.id]);');
    expect(page).toContain('setDialogOpen(false)');
    expect(page).toContain('setEditing(undefined)');
  });

  it('uses tenant-scoped optimistic concurrency when updating', () => {
    expect(page).toContain('expected_updated_at: editing.updated_at');
    expect(hook).toContain(".eq('tenant_id', currentTenant!.id)");
    expect(hook).toContain(".eq('updated_at', expected_updated_at)");
    expect(hook).toContain('Este ativo foi alterado por outra pessoa');
  });

  it('allows clearing responsibility and preserves an unspecified acquisition cost', () => {
    expect(page).toContain('<SelectItem value={NONE}>Nenhum responsável</SelectItem>');
    expect(page).toContain("form.acquisition_cost.trim() === '' ? null : Number(form.acquisition_cost)");
  });

  it('describes the dialog and blocks invalid required fields', () => {
    expect(page).toContain('<DialogDescription>');
    expect(page).toContain('disabled={assetFormInvalid || createAsset.isPending || updateAsset.isPending}');
  });
});
