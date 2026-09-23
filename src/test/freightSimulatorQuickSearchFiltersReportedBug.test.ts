import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/pages/FreightSimulator.tsx', 'utf8');

describe('filtros da busca rápida no simulador de frete', () => {
  it('reaplica tipo, validade e duplicidade no fallback fora do período', () => {
    const fallback = page.slice(page.indexOf('// Fallback: query DB ignoring period filter'), page.indexOf('const d = candidates[0]'));
    expect(fallback).toContain("query.eq('document_type', 'outbound')");
    expect(fallback).toContain("query.eq('document_type', 'inbound')");
    expect(fallback).toContain("query.not('status', 'in', '(cancelled,canceled,rejected,denied,draft)')");
    expect(fallback).toContain("query.eq('is_duplicate', false)");
    expect(fallback).toContain('deduplicateFreightDocuments(data || [])');
  });

  it('aplica a exclusão explícita de duplicados também à lista principal', () => {
    expect(page.match(/\.eq\('is_duplicate', false\)/g)).toHaveLength(2);
  });
});
