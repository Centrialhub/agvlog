import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getErrorMessage } from '@/lib/errors';

describe('asset employee relationship', () => {
  it('selects the responsible employee through an explicit foreign key', () => {
    const hook = readFileSync('src/hooks/useAssets.tsx', 'utf8');
    expect(hook).toContain('employees!assets_responsible_employee_id_fkey(name)');
    expect(hook).not.toContain("select('*, employees(name)')");
  });

  it('shows PostgREST object errors instead of an unknown-error placeholder', () => {
    expect(getErrorMessage({ message: 'relationship is ambiguous' }, 'erro desconhecido'))
      .toBe('relationship is ambiguous');
    expect(getErrorMessage({}, 'erro desconhecido')).toBe('erro desconhecido');
  });
});
