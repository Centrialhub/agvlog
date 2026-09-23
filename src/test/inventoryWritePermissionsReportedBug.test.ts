import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('inventory write controls',()=>{
 it('shows creation controls only to administrators and explains read-only access',()=>{
  const source=readFileSync('src/pages/Inventory.tsx','utf8');
  expect(source).toContain('const isAdmin = useIsAdmin()');
  expect(source).toContain('{isAdmin ? <div className="flex gap-2">');
  expect(source).toContain('Somente administradores podem registrar movimentos ou locais.');
 });
});
