// @vitest-environment node
// Real predecessor/driver SQL in isolated PGlite. HTTP/JWT verification are adapters,
// not native GoTrue/PostgREST or a production RLS approval. All rows are synthetic.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
vi.hoisted(() => vi.stubGlobal('Deno', { env: { get: () => undefined } }));
import { handleDriverAccess } from '../../supabase/functions/manage-driver-access/handler';
import { driverLoginEmail } from '../../supabase/functions/_shared/driverCredentials';
import { applyDriverForward, id, prepare, roleQuery, scope, setupDriverGraph } from './helpers/driverAccessDatabaseFixture';

let db: PGlite;
const forbiddenAuth = vi.fn(() => { throw new Error('No Auth mutations allowed in this fixture'); });
beforeAll(async () => {
  db = await setupDriverGraph();
  // Replace the existing mixed-role/inactive fixture BEFORE guards are installed.
  // The incident is a legacy driver ACTIVE in two companies, no elevated role.
  await db.query("update tenant_memberships set role='driver',active=true where user_id=$1", [id.shared]);
  await db.query('update drivers set user_id=$1 where id=$2', [id.shared,id.foreignDriver]);
  await applyDriverForward(db);
}, 30_000);
afterAll(async () => { await db?.close(); vi.unstubAllGlobals(); });

const graph = async () => (await db.query<Record<string, unknown>>(`select
  (select jsonb_agg(to_jsonb(m) order by tenant_id) from tenant_memberships m where user_id=$1) memberships,
  (select jsonb_agg(to_jsonb(d) order by tenant_id) from drivers d where user_id=$1) drivers,
  (select jsonb_build_object('id',id,'metadata',raw_app_meta_data,'deleted_at',deleted_at) from auth.users where id=$1) identity`, [id.shared])).rows;

// Narrow adapter: all authorization/membership/driver reads and scope RPC execute
// against PGlite. No mocked successful SQL result and no external network request.
function client() {
  return {
    auth: { admin: { createUser: forbiddenAuth, updateUserById: forbiddenAuth, deleteUser: forbiddenAuth } },
    from(table: string) {
      if (!['tenant_memberships','drivers'].includes(table)) throw new Error('Unexpected table');
      const filters: Array<[string,unknown]> = [];
      let allowedRoles: string[] | null = null;
      const chain = {
        select: () => chain,
        eq: (column: string,value: unknown) => { filters.push([column,value]); return chain; },
        in: (column: string,values: string[]) => { if(column!=='role') throw new Error('Unexpected filter'); allowedRoles=values; return chain; },
        maybeSingle: async () => {
          const values = filters.map(([,value]) => value);
          const clauses = filters.map(([column],index) => {
            if(!['tenant_id','user_id','active','id'].includes(column)) throw new Error('Unexpected column');
            return `${column}=$${index+1}`;
          });
          if(allowedRoles) { values.push(allowedRoles); clauses.push(`role::text=any($${values.length}::text[])`); }
          const { rows } = await roleQuery(db,'service_role',`select * from ${table} where ${clauses.join(' and ')}`,values);
          if(rows.length>1) throw new Error('Adapter refuses ambiguous rows');
          return {data: rows[0] ?? null,error:null};
        },
      };
      return chain;
    },
    rpc: async (name: string,args: Record<string,unknown>) => {
      if(name!=='driver_access_scope_v1') throw new Error('Unexpected RPC');
      try {
        const result=await roleQuery<{value:unknown}>(db,'service_role',
          'select public.driver_access_scope_v1($1,$2,$3,$4) value',
          [args._tenant_id,args._actor_id,args._user_id,args._retire]);
        return {data:result.rows[0].value,error:null};
      } catch(error) { return {data:null,error:{message:(error as Error).message}}; }
    },
  } as unknown as SupabaseClient;
}
async function request(action: string, target: 'driver'|'member'='driver', actor=id.admin, tenant=id.tenant, header=tenant, version?: number, targetUser=id.shared) {
  const token = `fixture.${btoa(JSON.stringify({sub:actor,active_tenant_id:tenant}))}.fixture`;
  const caller = {auth:{getUser:async()=>({data:{user:{id:actor}},error:null})}} as unknown as SupabaseClient;
  return handleDriverAccess(new Request('https://fixture.invalid', {method:'POST',headers:{
    authorization:`Bearer ${token}`,'x-agvlog-tenant-id':header,
  },body:JSON.stringify({action,version,tenant_id:tenant,...(target==='driver'?{driver_id:id.sharedDriver}:{user_id:targetUser})})}),caller,client(),{});
}

describe('active legacy driver in two companies', () => {
  it('executes the real scope guard with two active driver roles and preserves the graph', async () => {
    const before=await graph();
    expect((await db.query('select role,active from tenant_memberships where user_id=$1',[id.shared])).rows)
      .toEqual([{role:'driver',active:true},{role:'driver',active:true}]);
    await expect(scope(db,id.shared,false)).rejects.toThrow('driver_account_shared_or_other_role');
    expect(await graph()).toEqual(before);
  });
  it.each(['driver','member'] as const)('reproduces inspect 409 from the %s entry without proposing removal of links', async target => {
    const before=await graph(); const response=await request('inspect',target);
    expect(response.status).toBe(409);
    const body=await response.json();
    expect(body.error).toContain('Conta compartilhada');
    expect(body.error).toContain('O cadastro do motorista é separado');
    expect(body.error).not.toContain('Revise os vínculos antes de excluir');
    expect(await graph()).toEqual(before); expect(forbiddenAuth).not.toHaveBeenCalled();
  });
  it('blocks password, retirement and creating a replacement on the linked registry without any mutation', async () => {
    const before=await graph();
    for(const action of ['password','retire_legacy','create']) expect((await request(action)).status).toBe(409);
    await expect(prepare(db,id.sharedDriver)).rejects.toThrow('driver_unavailable_or_already_linked');
    expect(await graph()).toEqual(before); expect(forbiddenAuth).not.toHaveBeenCalled();
  });
  it('does not apply the global-account guard to a local registry name update', async () => {
    const before=await graph();
    // Service-role write models ONLY trigger behavior, not browser RLS permission.
    await roleQuery(db,'service_role','update drivers set name=$1,user_id=$2,tenant_id=$3 where id=$4 and tenant_id=$3',
      ['Local synthetic label',id.shared,id.tenant,id.sharedDriver]);
    expect((await db.query('select name,user_id from drivers where id=$1',[id.sharedDriver])).rows)
      .toEqual([{name:'Local synthetic label',user_id:id.shared}]);
    const after=await graph();
    expect(after[0].memberships).toEqual(before[0].memberships);
    expect(after[0].identity).toEqual(before[0].identity);
    expect((after[0].drivers as Array<{tenant_id:string}>).filter(x=>x.tenant_id===id.otherTenant))
      .toEqual((before[0].drivers as Array<{tenant_id:string}>).filter(x=>x.tenant_id===id.otherTenant));
  });
  it('rejects another company admin, a driver actor, and mismatched active-tenant context', async () => {
    const before=await graph();
    expect((await request('inspect','member',id.otherAdmin)).status).toBe(403);
    expect((await request('inspect','member',id.shared)).status).toBe(403);
    expect((await request('inspect','driver',id.otherAdmin,id.otherTenant)).status).toBe(404);
    expect((await request('inspect','member',id.admin,id.tenant,id.otherTenant)).status).toBe(409);
    expect(await graph()).toEqual(before); expect(forbiddenAuth).not.toHaveBeenCalled();
  });
  it('keeps username resolution global and deterministic, without tenant selection', () => {
    expect(driverLoginEmail(' QA.Driver ')).toBe('qa.driver@usuario.com');
  });
  it.each(['driver','member'] as const)('v2 inspects the existing local %s link without granting shared-identity mutation',async target=>{
    const before=await graph();
    const response=await request('inspect',target,id.admin,id.tenant,id.tenant,2);
    expect(response.status).toBe(200);
    const body=await response.json();
    expect(body).toMatchObject({version:2,kind:'linked',username:null,active:true,driver_id:id.sharedDriver,
      capabilities:{create_access:false,change_password:false,change_identity:false,delete_identity:false,unlink:false}});
    expect(body).not.toHaveProperty('email'); expect(body).not.toHaveProperty('other_tenants');
    expect(await graph()).toEqual(before); expect(forbiddenAuth).not.toHaveBeenCalled();
  });
  it('v2 does not turn a foreign driver or unauthorized actor into an inspectable local account',async()=>{
    const before=await graph();
    expect((await request('inspect','member',id.otherAdmin,id.tenant,id.tenant,2)).status).toBe(403);
    expect((await request('inspect','driver',id.otherAdmin,id.otherTenant,id.otherTenant,2)).status).toBe(404);
    expect((await request('inspect','member',id.admin,id.tenant,id.otherTenant,2)).status).toBe(409);
    expect((await request('inspect','member',id.admin,id.tenant,id.tenant,2,id.otherAdmin)).status).toBe(404);
    expect(await graph()).toEqual(before); expect(forbiddenAuth).not.toHaveBeenCalled();
  });
});
