import {afterEach,describe,expect,it,vi} from 'vitest';
import {activeTenantFetch,clearActiveTenantId,setActiveTenantId} from '@/lib/tenant/activeTenantContext';

afterEach(()=>clearActiveTenantId());

describe('active tenant request transport',()=>{
  it.each(['/rest/v1/fiscal_documents','/functions/v1/secure-upload','/storage/v1/object/private/path'])(
    'adds the active tenant to %s',async path=>{
      const upstream=vi.fn<typeof fetch>(async()=>new Response(null,{status:204}));
      setActiveTenantId('10000000-0000-4000-8000-000000000001');
      await activeTenantFetch('https://project.supabase.co',upstream)(`https://project.supabase.co${path}`,{headers:{'x-existing':'yes'}});
      const headers=new Headers(upstream.mock.calls[0][1]?.headers);
      expect(headers.get('x-agvlog-tenant-id')).toBe('10000000-0000-4000-8000-000000000001');
      expect(headers.get('x-existing')).toBe('yes');
    },
  );

  it.each(['/auth/v1/user','https://untrusted.test/rest/v1/private'])(
    'does not leak the tenant context to %s',async target=>{
      const upstream=vi.fn<typeof fetch>(async()=>new Response(null,{status:204}));
      setActiveTenantId('10000000-0000-4000-8000-000000000001');
      const url=target.startsWith('http')?target:`https://project.supabase.co${target}`;
      await activeTenantFetch('https://project.supabase.co',upstream)(url);
      expect(new Headers(upstream.mock.calls[0][1]?.headers).has('x-agvlog-tenant-id')).toBe(false);
    },
  );

  it('clears only the context that owns the cleanup',()=>{
    setActiveTenantId('tenant-b');
    clearActiveTenantId('tenant-a');
    setActiveTenantId('tenant-b');
    clearActiveTenantId('tenant-b');
    const upstream=vi.fn<typeof fetch>(async()=>new Response(null,{status:204}));
    void activeTenantFetch('https://project.supabase.co',upstream)('https://project.supabase.co/rest/v1/loads');
    expect(new Headers(upstream.mock.calls[0]?.[1]?.headers).has('x-agvlog-tenant-id')).toBe(false);
  });
});
