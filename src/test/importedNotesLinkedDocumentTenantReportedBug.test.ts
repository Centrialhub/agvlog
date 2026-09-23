import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('fallbacks fiscais do resumo de notas',()=>{
  it('restringe por tenant os vínculos diretos de CT-e e NFS-e',()=>{
    const hook=readFileSync('src/hooks/useImportedNotesSummary.tsx','utf8');
    const outbound=hook.slice(hook.indexOf('if (outboundIds.length > 0)'),hook.indexOf('// NFS-e (Montes Claros)'));
    const directNfse=hook.slice(hook.indexOf('if (missingNfseIds.length > 0)'),hook.indexOf('const enriched:'));
    expect(outbound).toContain(".eq('tenant_id', currentTenant.id)");
    expect(directNfse).toContain(".eq('tenant_id', currentTenant.id)");
  });
});
