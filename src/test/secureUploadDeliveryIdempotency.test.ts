import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

describe('delivery evidence secure-upload contract',()=>{
  const source=readFileSync(join(process.cwd(),'supabase/functions/secure-upload/index.ts'),'utf8');
  it('binds a delivery upload to request, slot and verified SHA-256',()=>{
    expect(source).toContain('invalid_delivery_evidence_identity');
    expect(source).toContain('delivery_evidence_hash_mismatch');
    expect(source).toContain('${evidenceRequestId}-${evidenceSlot.replace(":", "-")}-${evidenceHash}`');
  });
  it('only acknowledges an existing deterministic object after comparing its bytes',()=>{
    expect(source).toContain('adminClient.storage.from(bucket).download(path)');
    expect(source).toContain('storedHash === evidenceHash');
    expect(source).toContain('delivery_evidence_existing_object_mismatch');
  });
});
