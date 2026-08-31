// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptFiscalCredential } from '../../supabase/functions/_shared/fiscal-credential-crypto';
import { resolveHubFiscalToken } from '../../supabase/functions/_shared/fiscal-poll';

const state = vi.hoisted(() => ({
  handler: null as null | ((req: Request) => Promise<Response>),
  credential: null as null | Record<string, unknown>,
  writes: 0,
  role: 'owner',
}));
vi.mock('../../supabase/functions/_shared/capabilities.ts', () => ({ requireIntegrationCapability: vi.fn().mockResolvedValue(null) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'user' } }, error: null }) },
  from: (table: string) => {
    let columns = '*';
    let single = false;
    const filters: [string, unknown][] = [];
    const builder = {
      select: (value: string) => { columns = value; return builder; },
      eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; },
      in: () => builder, limit: () => builder,
      maybeSingle: () => { single = true; return builder; },
      single: () => { single = true; return builder; },
      upsert: (value: Record<string, unknown>) => { state.credential = { id: 'credential', ...value }; state.writes++; return builder; },
      then: (resolve: (value: unknown) => unknown) => {
        let rows: Record<string, unknown>[] = table === 'tenant_emitters'
          ? [{ id:'emitter',tenant_id:'tenant',active:true,cnpj:'12345678000199' }]
          : table === 'tenant_memberships' ? [{ user_id:'user',tenant_id:'tenant',active:true,role:state.role }]
          : state.credential ? [state.credential] : [];
        rows = rows.filter(row => filters.every(([key,value]) => row[key] === value));
        if (columns !== '*') rows = rows.map(row => Object.fromEntries(columns.split(',').map(key => [key.trim(), row[key.trim()]])));
        return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve);
      },
    };
    return builder;
  },
}) }));
const preview = 'https://agvlog-preview-thomaz-20260831.veituma.chatgpt.site';
const key = 'a1'.repeat(32);
const token = 'test-only-reentered-hub-token';
const fetcher = vi.fn();
let save: (req: Request) => Promise<Response>;
let proxy: (req: Request) => Promise<Response>;
const req = (body: Record<string, unknown>, auth = true, origin = preview) => new Request('https://edge.test', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(auth ? {Authorization:'Bearer test-user'} : {}) }, body: JSON.stringify(body),
});
beforeAll(async () => {
  const env: Record<string,string> = { SUPABASE_URL:'https://db.test', SUPABASE_SERVICE_ROLE_KEY:'service-test', SUPABASE_ANON_KEY:'anon-test', AGVLOG_ENCRYPTION_KEY:key };
  vi.stubGlobal('Deno', { env:{get:(name:string)=>env[name]}, serve:(handler:typeof state.handler)=>{ state.handler=handler; } });
  const savePath = '../../supabase/functions/hub-fiscal-credential-save/index.ts';
  await import(savePath); save = state.handler!;
  const proxyPath = '../../supabase/functions/hub-fiscal-proxy/index.ts';
  await import(proxyPath); proxy = state.handler!;
});
beforeEach(() => { state.credential=null;state.writes=0;state.role='owner';fetcher.mockReset();vi.stubGlobal('fetch',fetcher); });
afterAll(() => {vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('credential recovery through save, proxy ping and polling (no external requests)', () => {
  it('replaces an unreadable credential only with an explicitly reentered token and reads it across all consumers', async () => {
    state.credential={id:'credential',tenant_id:'tenant',emitter_id:'emitter',doc_scope:'all',environment:'production',enabled:true,secret_ciphertext:await encryptFiscalCredential('old-test-token','b2'.repeat(32)),secret_name:null};
    const ping={action:'ping',type:'cte',emitterId:'emitter',environment:'production'};
    const broken=await proxy(req(ping));
    expect(broken.status).toBe(400);
    expect((await broken.json()).error).toMatchObject({code:'HUB_CREDENTIAL_DECRYPT_FAILED'});
    expect(state.writes).toBe(0);
    const saved=await save(req({emitter_id:'emitter',doc_scope:'all',environment:'production',token}));
    expect(saved.status).toBe(200);
    expect(saved.headers.get('Access-Control-Allow-Origin')).toBe(preview);
    const visible=await saved.text();
    expect(visible).not.toContain(token);
    expect(visible).not.toContain('secret_ciphertext');
    expect(visible).not.toContain(key);
    expect(state.writes).toBe(1);
    const healthy=await proxy(req(ping));
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toMatchObject({success:true,has_token:true,source:'ciphertext',environment:'production'});
    const {createClient}=await import('@supabase/supabase-js');
    const admin=createClient('https://db.test','test-key');
    for(const scope of ['cte','nfse'] as const) {
      expect(await resolveHubFiscalToken(admin,{tenantId:'tenant',emitterId:'emitter',environment:'production',scope,encryptionKey:key,getSecret:()=>undefined})).toBe(token);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['operator','viewer'])('does not let %s replace a credential', async role => {
    state.role=role;
    expect((await save(req({emitter_id:'emitter',doc_scope:'all',environment:'production',token}))).status).toBe(403);
    expect(state.writes).toBe(0);
  });
  it('rejects anonymous and hostile-origin saves without writes', async () => {
    const body={emitter_id:'emitter',doc_scope:'all',environment:'production',token};
    expect((await save(req(body,false))).status).toBe(401);
    expect((await save(req(body,true,'https://other.veituma.chatgpt.site'))).status).toBe(403);
    expect(state.writes).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
