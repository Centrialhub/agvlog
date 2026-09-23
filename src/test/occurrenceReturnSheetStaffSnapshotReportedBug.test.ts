import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260922022000_snapshot_return_sheet_company_header.sql', 'utf8');
const pdf = readFileSync('src/lib/occurrences/occurrenceReturnSheetPdf.ts', 'utf8');

describe('occurrence return sheet load staff snapshot', () => {
  it('persists checker and helper from structured operational sources', () => {
    expect(migration).toContain('add column if not exists checker_name text');
    expect(migration).toContain('add column if not exists helper_name text');
    expect(migration).toContain("occurrence.metadata->>'conferente'");
    expect(migration).toContain("occurrence.metadata->>'ajudante'");
    expect(migration).toContain('load.checker_name');
    expect(migration).toContain('load.helper_name');
    expect(migration).toContain("'conferente',v_checker,'helper',v_helper");
    expect(pdf).toContain("s(load.conferente, '')");
    expect(pdf).toContain("s(load.helper, '')");
  });
});
