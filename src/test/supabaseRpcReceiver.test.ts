import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('Supabase RPC clients', () => {
  it('never detaches rpc from its SDK client receiver', () => {
    const files = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(file => file && !file.includes('/test/'));

    const offenders = files.filter(file => {
      const source = readFileSync(file, 'utf8');
      return /supabase\.rpc\s+as\s+unknown/.test(source);
    });

    expect(offenders).toEqual([]);
  });
});
