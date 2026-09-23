import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('traceability proof eligibility', () => {
  it('derives POD and receipt flags only from operationally valid proofs', () => {
    const source=readFileSync('src/pages/Traceability.tsx','utf8');
    const start=source.indexOf('const evidenceProofs');
    const end=source.indexOf('return {',start);
    const eligibility=source.slice(start,end);

    expect(eligibility).toContain("['uploaded', 'validated'].includes(proof.status)");
    expect(eligibility).not.toContain('proof.storage_path');
    expect(eligibility).not.toContain('proof.photo_url');
    expect(eligibility).not.toContain('proof.signature_url');
    expect(eligibility).not.toContain('proof.received_at');
  });
});
