import{readFileSync}from'node:fs';import{describe,expect,it}from'vitest';
const hook=readFileSync('src/hooks/useCostCenters.tsx','utf8'),manager=readFileSync('src/components/cost-centers/CostCenterManager.tsx','utf8');
describe('cost center stale-write protection',()=>{it('compares the loaded revision for toggles and deletion',()=>{
 expect(hook.match(/\.eq\('updated_at', expectedUpdatedAt\)/g)?.length).toBe(2);expect(hook.match(/\.maybeSingle\(\)/g)?.length).toBeGreaterThanOrEqual(2);expect(manager).toContain('expectedUpdatedAt: costCenter.updated_at');expect(manager).toContain('expectedUpdatedAt: deleteTarget.updated_at');
});});
