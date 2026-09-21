import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('asset management deployment route', () => {
  it('does not collide with Vite public assets and redirects old bookmarks', () => {
    const root = process.cwd();
    const routes = readFileSync(join(root, 'src', 'app', 'AppRoutes.tsx'), 'utf8');
    const navigation = readFileSync(join(root, 'src', 'components', 'layout', 'navigation.ts'), 'utf8');
    const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as {
      redirects?: Array<{ source: string; destination: string; permanent?: boolean }>;
    };

    expect(routes).toContain('path="/asset-management"');
    expect(routes).not.toContain('path="/assets"');
    expect(navigation).toContain("href: '/asset-management'");
    expect(vercel.redirects).toContainEqual({
      source: '/assets',
      destination: '/asset-management',
      permanent: true,
    });
  });
});
