import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('acesso administrativo à equipe', () => {
  it('protege rota, menu e leituras antes de montar dados sensíveis', () => {
    const routes = readFileSync('src/app/AppRoutes.tsx', 'utf8');
    const navigation = readFileSync('src/components/layout/navigation.ts', 'utf8');
    const page = readFileSync('src/pages/TeamManagement.tsx', 'utf8');

    expect(routes).toContain('path="/team" element={<ProtectedRoute roles={[\'owner\', \'admin\']}><TeamManagement />');
    expect(navigation).toContain("href: '/team', icon: UserCog, roles: ['owner', 'admin']");
    expect(page).toContain('enabled: isAdmin && !!currentTenant');
    expect(page).toContain('useDrivers({ enabled: isAdmin })');
  });
});
