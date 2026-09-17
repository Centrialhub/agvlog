import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Hub Fiscal file transport contract', () => {
  it('tries the Hub GET cache before on-demand delivery and auto-refreshes only when unspecified', () => {
    const source = readSource('supabase/functions/hub-fiscal-proxy/index.ts');
    const fileCase = source.slice(source.indexOf("case 'file':"), source.indexOf("case 'preview':"));
    expect(fileCase.indexOf('await tryDirectHubFile()')).toBeGreaterThan(-1);
    expect(fileCase.indexOf('await tryDirectHubFile()')).toBeLessThan(fileCase.indexOf('await tryOnDemand('));
    expect(fileCase).toContain('await tryOnDemand(payload.forceRefresh === true)');
    expect(fileCase).toContain('payload.forceRefresh === undefined');
    expect(fileCase).toContain('await tryOnDemand(true)');
    expect(fileCase).toContain("'X-HubFiscal-Api-Version': HUB_API_VERSION");
    expect(fileCase).toContain('FILE_REQUEST_TIMEOUT_MS');
  });

  it('tries stored CT-e and NFS-e links before the authenticated proxy', () => {
    const cte = readSource('src/lib/fiscal/cteFiles.ts');
    expect(cte.indexOf('fetchCachedFiscalBlob')).toBeLessThan(cte.indexOf('hubFiscal.file', cte.indexOf('fetchCteBlob')));

    const nfse = readSource('src/pages/NFSe.tsx');
    const helper = nfse.slice(nfse.indexOf('async function fetchNfseBlob'), nfse.indexOf('async function downloadOne'));
    expect(helper.indexOf('fetchCachedFiscalBlob')).toBeLessThan(helper.indexOf('hubFiscal.file'));
  });
});
