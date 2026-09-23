import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('limites das listagens legadas do portal', () => {
  it('aplica o guard compartilhado a coletas e ocorrências', () => {
    const sql = readFileSync('supabase/migrations/20260921120500_bound_portal_list_limits.sql', 'utf8');
    expect(sql).toContain('public.list_client_pickups_v2(uuid,uuid,text,timestamptz,timestamptz,integer,integer)');
    expect(sql).toContain('public.list_client_occurrences_v2(uuid,uuid,text,boolean,integer,integer)');
    expect(sql).toContain('_limit IS NULL OR _limit NOT BETWEEN 1 AND 200');
    expect(sql).toContain('_offset IS NULL OR _offset NOT BETWEEN 0 AND 1000000');
  });
});
