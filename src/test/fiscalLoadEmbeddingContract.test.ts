// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '@/integrations/supabase/types';

// Complementary wire-contract coverage: real supabase-js serializes each actual
// source projection. The HTTP fixture reproduces the observed PGRST201 response;
// it does not implement PostgREST's relation planner or prove native RLS/Auth.
const consumers = [
  ['NewLoadDialog', 'src/components/loads/NewLoadDialog.tsx'],
  ['LoadItemsPanel', 'src/components/loads/LoadItemsPanel.tsx'],
  ['useBillingDocuments', 'src/hooks/useBillingDocuments.tsx'],
  ['useFiscalDocuments', 'src/hooks/useFiscalDocuments.tsx'],
  ['Traceability', 'src/pages/Traceability.tsx'],
] as const;
const hint = 'loads!fiscal_documents_load_id_fkey';
const tenant = '10000000-0000-4000-8000-000000000001';
const linked = { id: 'linked', tenant_id: tenant, load_id: 'load', loads: { id: 'load', load_number: '123' } };
const unlinked = { id: 'unlinked', tenant_id: tenant, load_id: null, loads: null };

function projection(path: string) {
  const source = readFileSync(path, 'utf8');
  const matches = [...source.matchAll(/\.from\('fiscal_documents'\)\s*\.select\('([^']+)'/g)]
    .map(match => match[1]).filter(select => /\bloads[!(]/.test(select));
  expect(matches, 'Expected exactly one fiscal-to-load projection in ' + path).toHaveLength(1);
  return matches[0];
}

function transport() {
  const requests: URL[] = [];
  const supabase = createClient<Database>('https://fixture.invalid', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async input => {
      const url = new URL(String(input));
      requests.push(url);
      const select = url.searchParams.get('select') ?? '';
      if (/\bloads\(/.test(select)) return new Response(JSON.stringify({
        code: 'PGRST201', message: 'Could not embed because more than one relationship was found',
        hint: 'Use loads!fiscal_documents_load_id_fkey or loads!fiscal_documents_load_tenant_fkey',
      }), { status: 300, headers: { 'Content-Type': 'application/json' } });
      if (!select.includes(hint + '(') || select.includes('!inner') || url.searchParams.get('tenant_id') !== 'eq.' + tenant) {
        return new Response(JSON.stringify({ code: 'FIXTURE_CONTRACT', message: 'Unexpected projection or tenant filter' }), { status: 400 });
      }
      return new Response(JSON.stringify([linked, unlinked]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  return { supabase, requests };
}

describe('fiscal_documents load embedding with concurrent foreign keys', () => {
  it('retains the observed ambiguous response as a failing wire-contract control', async () => {
    const { supabase } = transport();
    const { data, error, status } = await supabase.from('fiscal_documents')
      .select('id,loads(id,load_number)').eq('tenant_id', tenant);
    expect(status).toBe(300);
    expect(data).toBeNull();
    expect(error).toMatchObject({ code: 'PGRST201' });
  });

  it.each(consumers)('%s qualifies the legacy FK and retains the nullable loads object', async (_name, path) => {
    const select = projection(path);
    const { supabase, requests } = transport();
    const { data, error, status } = await supabase.from('fiscal_documents')
      .select(select).eq('tenant_id', tenant);
    expect(status).toBe(200);
    expect(error).toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get('select')).toBe(select.replace(/\s/g, ''));
    expect(data).toEqual([linked, unlinked]);
    expect(select).toContain(hint + '(');
    expect(select).not.toContain('!inner');
    expect(select).not.toMatch(/\w+:loads/);
  });
});
