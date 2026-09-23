import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration=readFileSync('supabase/migrations/20260921194430_snapshot_delivery_receipt_filter_options.sql','utf8');
const client=readFileSync('src/lib/deliveryReceipts/deliveryReceiptOperations.ts','utf8');

describe('snapshot dos catálogos de filtros de canhotos',()=>{
  it('materializa a primeira página e vincula as continuações ao ator e à consulta',()=>{
    expect(migration).toContain('delivery_receipt_filter_option_snapshots');
    expect(migration).toContain('snapshot.actor_id=v_actor');
    expect(migration).toContain('snapshot.kind=_kind and snapshot.search=v_search');
    expect(migration).toContain('or (_cursor_label is not null and _snapshot_id is null)');
  });

  it('devolve e reenvia o snapshot no cursor seguinte',()=>{
    expect(client).toContain('snapshot_id:id');
    expect(client).toContain('_snapshot_id:cursor?.snapshotId??null');
    expect(client).toContain('snapshotId:parsed.data.snapshot_id');
  });
});
