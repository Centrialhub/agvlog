import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('falha na consulta de romaneios elegíveis', () => {
  it('distingue erro de resultado vazio e oferece nova tentativa', () => {
    const picker = readFileSync('src/components/financial/LoadPicker.tsx', 'utf8');
    expect(picker).toContain('isError, error, refetch');
    expect(picker).toContain('Romaneios indisponíveis.');
    expect(picker).toContain('role="alert"');
    expect(picker).toContain('onClick={() => void refetch()}');
    expect(picker).toContain('loads.length === 0 && !isLoading && !isError');
  });
});
