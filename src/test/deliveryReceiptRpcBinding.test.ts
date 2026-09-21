import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const clients = [
  'src/lib/deliveryReceipts/deliveryReceiptOperations.ts',
  'src/lib/deliveryReceipts/deliveryReceiptOperationsDashboard.ts',
  'src/lib/deliveryReceipts/deliveryReceiptChannels.ts',
  'src/lib/driver/receiptQualityPolicy.ts',
];

describe('delivery receipt RPC clients', () => {
  it.each(clients)('keeps the Supabase SDK receiver in %s', file => {
    const source = readFileSync(file, 'utf8');
    expect(source).toContain('supabase.rpc.bind(supabase)');
    expect(source).not.toMatch(/const rpc\s*=\s*supabase\.rpc\s+as/);
  });
});
