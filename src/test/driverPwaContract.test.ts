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

  it('does not cache arbitrary same-origin images or delete unrelated caches', () => {
    const worker = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');

    expect(worker).toContain("key.startsWith(CACHE_PREFIX)");
    expect(worker).toContain("url.pathname.startsWith('/assets/')");
    expect(worker).toContain("url.pathname.startsWith('/icons/')");
    expect(worker).not.toContain("['script', 'style', 'font', 'image'].includes(request.destination)");
    expect(worker).not.toContain('self.skipWaiting()');
  });
});
