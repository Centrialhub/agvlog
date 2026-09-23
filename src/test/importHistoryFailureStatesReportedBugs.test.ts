import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('históricos de importação publicados',()=>{
  it.each([
    ['faltas','src/pages/MerchandiseShortages.tsx','imports'],
    ['cargas','src/pages/LoadControl.tsx','batchesQuery'],
  ])('%s distingue carregamento, erro com retry e vazio real',(_name,file,query)=>{
    const source=readFileSync(file,'utf8');
    expect(source).toContain(`${query}.isPending`);
    expect(source).toContain(`${query}.isError`);
    expect(source).toContain(`${query}.refetch()`);
    expect(source).toContain('Nenhuma importação registrada.');
    expect(source).toContain('role="alert"');
  });
});
