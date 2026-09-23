import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('regeneração de CT-e após remoção lógica',()=>{
  it('considera somente CT-e ativo na verificação de existência',()=>{
    const hook=readFileSync('src/hooks/useGenerateCTe.tsx','utf8');
    const start=hook.indexOf('// Check if CT-e already exists for this load');
    const end=hook.indexOf('if (existing && existing.length > 0)',start);
    expect(hook.slice(start,end)).toContain(".is('deleted_at', null)");
  });
});
