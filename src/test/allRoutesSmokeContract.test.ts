import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appRoutes = readFileSync('src/app/AppRoutes.tsx', 'utf8');
const smokeSpec = readFileSync('e2e/all-routes-smoke.spec.ts', 'utf8');

describe('all-routes smoke registry', () => {
  it('covers every protected absolute route registered by the application', () => {
    const registered = [...appRoutes.matchAll(/<Route\s+path="(\/[^"*]+)"/g)]
      .map((match) => match[1])
      .filter((path) => !['/auth', '/set-password'].includes(path));

    for (const path of registered) {
      const dynamicSegment = path.indexOf('/:');
      if (dynamicSegment >= 0) {
        expect(smokeSpec, `missing dynamic smoke route for ${path}`)
          .toContain(path.slice(0, dynamicSegment + 1));
      } else {
        expect(smokeSpec, `missing smoke route for ${path}`).toContain(`"${path}"`);
      }
    }
  });
});
