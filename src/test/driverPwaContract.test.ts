import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('driver PWA contract', () => {
  it('ships installable icons and a driver start URL', () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'public', 'manifest.webmanifest'), 'utf8')) as {
      id: string;
      start_url: string;
      icons: Array<{ src: string; sizes: string; type: string }>;
    };

    expect(manifest.id).toBe('/driver');
    expect(manifest.start_url).toBe('/driver');
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: '/icons/agvlog-192.png', sizes: '192x192', type: 'image/png' }),
      expect.objectContaining({ src: '/icons/agvlog-512.png', sizes: '512x512', type: 'image/png' }),
    ]));
  });

  it('pre-caches the hashed application shell without caching arbitrary images', () => {
    const worker = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');

    expect(worker).toContain("key.startsWith(CACHE_PREFIX)");
    expect(worker).toContain("url.pathname.startsWith('/assets/')");
    expect(worker).toContain("url.pathname.startsWith('/icons/')");
    expect(worker).toContain("html.matchAll(/(?:src|href)");
    expect(worker).toContain("fetch('/driver-shell-assets.json'");
    expect(worker).toContain("'/driver-build.json'");
    expect(worker).toContain("path.startsWith('/assets/')");
    expect(worker).toContain("const BUILD_HASH = '__AGVLOG_BUILD_HASH__'");
    expect(worker).toContain('await cache.addAll(required)');
    expect(worker).toContain("await Promise.all(['/',...required].map(path=>cache.match(path)))");
    expect(worker).toContain('await caches.delete(CACHE_NAME)');
    expect(worker).toContain("const isBuildAsset = url.pathname.startsWith('/assets/');");
    expect(worker).not.toContain("request.destination);");
    expect(worker).toContain("event.data?.type === 'ACTIVATE_UPDATE'");
    expect(worker.indexOf("event.data?.type === 'ACTIVATE_UPDATE'")).toBeLessThan(worker.indexOf('self.skipWaiting()'));
  });

  it('emits a build manifest containing the lazy driver routes and their imports',()=>{
    const config=readFileSync(join(process.cwd(),'vite.config.ts'),'utf8');
    expect(config).toContain("name: 'pwa-driver-asset-manifest'");
    expect(config).toContain("moduleId.includes('/pages/driver/')");
    expect(config).toContain("fileName:'driver-shell-assets.json'");
    expect(config).toContain("fileName:'driver-build.json'");
    expect(config).toContain("createHash('sha256')");
    expect(config).toContain("workerTemplate.replace(/__AGVLOG_BUILD_HASH__/g,buildHash)");
  });

  it('exposes installation and user-controlled update UX in the driver shell',()=>{
    const component=readFileSync(join(process.cwd(),'src','components','driver','DriverPwaInstall.tsx'),'utf8');
    const layout=readFileSync(join(process.cwd(),'src','components','layout','DriverLayout.tsx'),'utf8');
    expect(component).toContain('beforeinstallprompt');
    expect(component).toContain('Adicionar à Tela de Início');
    expect(component).toContain("postMessage({type:'ACTIVATE_UPDATE'})");
    expect(layout).toContain('<DriverPwaInstall />');
  });
});
