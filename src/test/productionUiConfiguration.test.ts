import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');

describe('production UI configuration contract', () => {
  it('keeps baseline web security headers enabled', () => {
    const config = read('vercel.json');
    for (const header of [
      'Content-Security-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options',
    ]) {
      expect(config).toContain(header);
    }
  });

  it('allows the external address lookup origins used directly by the browser', () => {
    const config = JSON.parse(read('vercel.json')) as {
      headers: Array<{ headers: Array<{ key: string; value: string }> }>;
    };
    const policy = config.headers.flatMap(rule => rule.headers)
      .find(header => header.key === 'Content-Security-Policy')?.value ?? '';
    const connectSources = policy.match(/(?:^|;)\s*connect-src\s+([^;]+)/)?.[1].split(/\s+/) ?? [];
    const browserLookupSources = [
      read('src', 'lib', 'fiscal', 'nfseAddressAutocomplete.ts'),
      read('src', 'components', 'clients', 'ClientFormDialog.tsx'),
    ].join('\n');
    const origins = [...browserLookupSources.matchAll(/\b(?:fetch|fetcher)\s*\(\s*`(https:\/\/[^/]+)/g)]
      .map(match => match[1]);
    expect(new Set(origins)).toEqual(new Set(['https://viacep.com.br', 'https://brasilapi.com.br']));
    for (const origin of origins) expect(connectSources).toContain(origin);
  });

  it('keeps fiscal operations pinned to production without an environment selector', () => {
    const operationalSources = [
      read('src', 'pages', 'NFSe.tsx'),
      read('src', 'components', 'nfse', 'NFSeFormDialog.tsx'),
      read('src', 'components', 'nfse', 'NFSeFromInvoicesDialog.tsx'),
      read('src', 'components', 'loads', 'NFSePanel.tsx'),
      read('src', 'components', 'loads', 'ManifestPanel.tsx'),
      read('src', 'components', 'billing', 'CteEmissionPreviewDialog.tsx'),
      read('src', 'components', 'settings', 'EmittersSettings.tsx'),
    ].join('\n');

    expect(operationalSources).not.toContain('FiscalEnvironmentSelect');
    expect(operationalSources).not.toMatch(/>\s*(?:Homologação|Sandbox)\s*</i);
    expect(operationalSources).toContain('PRODUCTION_HUB_ENVIRONMENT');
    expect(read('src', 'lib', 'fiscal', 'cteBuilder.ts')).toContain("input.emitter?.environment || 'production'");
    expect(read('src', 'lib', 'fiscal', 'mdfeBuilder.ts')).toContain("input.emitter.environment || 'production'");
    const nfseHook = read('src', 'hooks', 'useNFSe.tsx');
    expect(nfseHook).toContain('export function useIssueNFSe()');
    expect(nfseHook).toContain('export function useIssueNFSeBatch()');
    expect(nfseHook).toContain('const environment = PRODUCTION_HUB_ENVIRONMENT');
  });

  it('does not present disabled integrations as unfinished product features', () => {
    const userFacingSources = [
      read('src', 'components', 'layout', 'SidebarNavigation.tsx'),
      read('src', 'components', 'integrations', 'IntegrationUnavailable.tsx'),
      read('src', 'pages', 'Drivers.tsx'),
      read('src', 'pages', 'FleetMap.tsx'),
    ].join('\n');

    expect(userFacingSources).not.toContain('Integração em implantação');
    expect(userFacingSources).not.toContain('Diagnóstico SSX (manual)');
    expect(userFacingSources).toContain('Sincronizar SSX');
  });
});
