import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('waived trip cargo receipt counts',()=>{
  it('aligns both the detail and list read models with normal close eligibility',()=>{
    const migration=readFileSync('supabase/migrations/20260921191034_align_waived_receipt_counts.sql','utf8');
    expect(migration).toContain('public.get_trip_cargo_control_v2(uuid,uuid)');
    expect(migration).toContain('public.list_trip_cargo_controls_v2(uuid,text,integer,integer,text)');
    expect(migration).toContain("physical_status not in (''received'',''waived'')");
    expect(migration).toContain('waived_receipt_count_predicate_not_found');
  });
});
