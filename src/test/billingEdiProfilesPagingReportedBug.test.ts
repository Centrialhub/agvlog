import{readFileSync}from'node:fs';import{describe,expect,it}from'vitest';
const hook=readFileSync('src/hooks/useBillingEdi.tsx','utf8');
describe('complete DOCCOB profile catalog',()=>{it('walks every deterministic profile page',()=>{
 const body=hook.slice(hook.indexOf('export function useEdiProfiles'),hook.indexOf('export function useEdiExports'));
 expect(body).toContain('fetchAllPostgrestPages');expect(body).toContain(".order('name').order('id').range(from,to)");
});});
