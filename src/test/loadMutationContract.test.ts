import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ITEM_STATUSES } from '@/hooks/useLoadItems';
import { LOAD_TRANSITIONS } from '@/lib/statusPipeline';

const sql = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '20260826160000_canonical_load_mutations.sql'),
  'utf8',
);

function quotedValues(fragment: string) {
  return [...fragment.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

describe('contrato canônico de mutações de carga', () => {
  it('mantém a máquina de estados SQL alinhada ao frontend', () => {
    for (const [from, expected] of Object.entries(LOAD_TRANSITIONS)) {
      if (expected.length === 0) {
        expect(sql).not.toContain(`WHEN '${from}' THEN ARRAY[`);
        continue;
      }
      const match = sql.match(new RegExp(`WHEN '${from}' THEN ARRAY\\[([^\\]]+)\\]`));
      expect(match, `transição SQL ausente para ${from}`).not.toBeNull();
      expect(quotedValues(match?.[1] ?? '')).toEqual(expected);
    }
  });

  it('mantém os estados de item aceitos pelo RPC alinhados ao hook', () => {
    const match = sql.match(/p_status <> ALL\(ARRAY\[([\s\S]*?)\]\)/);
    expect(match).not.toBeNull();
    expect(quotedValues(match?.[1] ?? '')).toEqual(ITEM_STATUSES);
  });

  it('bloqueia e audita exclusões, removendo RPCs legados do browser', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.delete_load_item_v3');
    expect(sql).toContain("IF public._load_is_locked(v_load_id) THEN RAISE EXCEPTION 'load_locked'; END IF;");
    expect(sql).toContain("'delete_load_item_v3'");
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION %s FROM authenticated');
  });
});
