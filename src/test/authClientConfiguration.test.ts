import {beforeEach,describe,expect,it,vi} from 'vitest';

const state=vi.hoisted(()=>({options:undefined as Record<string,unknown>|undefined,password:vi.fn(),getUser:vi.fn()}));

vi.mock('@supabase/supabase-js',async importOriginal=>{
  const actual=await importOriginal<typeof import('@supabase/supabase-js')>();
  return {...actual,createClient:vi.fn((_url:string,_key:string,options:Record<string,unknown>)=>{
    state.options=options;
    return {auth:{signInWithPassword:state.password,getUser:state.getUser}};
  })};
});

import {createAppClient} from '@/integrations/supabase/createAppClient';
import {clearActiveTenantId,setActiveTenantId} from '@/lib/tenant/activeTenantContext';

const storage={getItem:vi.fn(()=>null),setItem:vi.fn(),removeItem:vi.fn()};

describe('Supabase Auth client configuration',()=>{
  beforeEach(()=>{
    clearActiveTenantId();
    state.options=undefined;
    state.password.mockReset().mockResolvedValue({data:{user:null,session:null},error:null});
    state.getUser.mockReset().mockResolvedValue({data:{user:null},error:null});
    storage.getItem.mockClear();storage.setItem.mockClear();storage.removeItem.mockClear();
  });

  it('injects active tenant context through the configured transport',async()=>{
    const upstream=vi.fn<typeof fetch>(async()=>new Response(null,{status:204}));
    setActiveTenantId('10000000-0000-4000-8000-000000000001');
    createAppClient('https://project-ref.supabase.co','publishable-key',{storage,fetch:upstream});
    const transport=(state.options?.global as {fetch:typeof fetch}).fetch;
    await transport('https://project-ref.supabase.co/rest/v1/fiscal_documents');
    expect(new Headers(upstream.mock.calls[0][1]?.headers).get('x-agvlog-tenant-id')).toBe('10000000-0000-4000-8000-000000000001');
  });

  it('uses the SDK lockless path without deprecated custom-lock options',()=>{
    createAppClient('https://project-ref.supabase.co','publishable-key',{storage});
    const auth=(state.options?.auth??{}) as Record<string,unknown>;
    expect(auth).not.toHaveProperty('lock');
    expect(auth).not.toHaveProperty('lockAcquireTimeout');
    expect(auth).toMatchObject({persistSession:true,storageKey:'sb-project-ref-auth-token',autoRefreshToken:true,detectSessionInUrl:true});
  });

  it('keeps password login coordinated explicitly outside the SDK client',async()=>{
    const client=createAppClient('https://project-ref.supabase.co','publishable-key',{storage});
    const credentials={email:'operator@example.test',password:'valid-password'};
    await client.auth.signInWithPassword(credentials);
    expect(state.password).toHaveBeenCalledOnce();
    expect(state.password).toHaveBeenCalledWith(credentials);
  });
});
