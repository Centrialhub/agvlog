// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  inserts: [] as Record<string, unknown>[],
  handler: null as null | ((request: Request) => Promise<Response>),
  env: {
    SUPABASE_URL: 'https://db.example.test', SUPABASE_ANON_KEY: 'anon-test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-test', HUB_FISCAL_BASE_URL: 'https://hub.example.test',
    HUB_FISCAL_API_KEY: 'GLOBAL_PRODUCTION_TOKEN_MUST_NEVER_BE_USED',
    PROD_TOKEN: 'production-scoped', HOM_TOKEN: 'homologation-scoped',
  } as Record<string, string>,
}));

vi.mock('../../supabase/functions/_shared/capabilities.ts', () => ({ requireIntegrationCapability: vi.fn().mockResolvedValue(null) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    if(name==='prepare_nfse_issue_batch_v1') {
      state.inserts.push({ kind: 'nfse_batch', request_id: args._request_id, snapshot: args._snapshot });
      return {data:{recovered:false,requestId:args._request_id,mode:args._mode},error:null};
    }
    if(name==='claim_hub_fiscal_emission') {
      const existing=state.tables.hub_fiscal_emissions.find(row=>
        row.tenant_id===args._tenant&&row.emitter_id===args._emitter&&row.environment===args._environment&&
        row.doc_type===args._type&&row.nfse_document_id===args._nfse_id
      );
      if(existing)return {data:{dispatch:false,emission:existing},error:null};
      const row={id:`saved-${state.tables.hub_fiscal_emissions.length+1}`,tenant_id:args._tenant,emitter_id:args._emitter,environment:args._environment,doc_type:args._type,
        nfse_document_id:args._nfse_id,request_payload:args._body,status:'pending'};
      state.inserts.push(row);state.tables.hub_fiscal_emissions.push(row);
      return {data:{dispatch:true,emission:row},error:null};
    }
    const response=args._response as {document?:Record<string,unknown>};
    const row=state.tables.hub_fiscal_emissions.find(row=>row.id===args._emission);
    if(!response?.document?.id)return {data:{confirmed:false},error:null};
    if(row&&response?.document)Object.assign(row,{status:response.document.status,hub_document_id:response.document.id});
    return {data:{confirmed:true},error:null};
  },
  auth: { getUser: async () => ({ data: { user: { id: 'user' } }, error: null }) },
  from: (table: string) => {
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    let single = false;
    let inserted: Record<string, unknown> | null = null;
    const builder = {
      select: () => builder,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return builder; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return builder; },
      limit: () => builder, order: () => builder,
      maybeSingle: () => { single = true; return builder; },
      single: () => { single = true; return builder; },
      insert: (row: Record<string, unknown>) => { inserted = { id: 'saved', ...row }; state.inserts.push(inserted); return builder; },
      update: () => builder,
      then: (resolve: (value: unknown) => unknown) => {
        const rows = (state.tables[table] || []).filter(row => filters.every(filter => filter(row)));
        return Promise.resolve({ data: inserted || (single ? rows[0] || null : rows), error: null }).then(resolve);
      },
    };
    return builder;
  },
}) }));

const fetcher = vi.fn<typeof fetch>();
const tenantId = '10000000-0000-4000-8000-000000000001';
const otherTenantId = '10000000-0000-4000-8000-000000000002';
const userToken = `test.${Buffer.from(JSON.stringify({active_tenant_id:tenantId})).toString('base64url')}.signature`;
const credential = (environment: string, scope = 'all', secret = environment === 'production' ? 'PROD_TOKEN' : 'HOM_TOKEN') => ({
  tenant_id: tenantId, emitter_id: 'emitter', environment, doc_scope: scope,
  secret_name: secret, secret_ciphertext: null, enabled: true,
});
const request = async (payload: Record<string, unknown>) => {
  if (!state.handler) throw new Error('Handler not loaded');
  return state.handler(new Request('https://edge.example.test', {
    method: 'POST', headers: { Authorization: `Bearer ${userToken}`, 'x-agvlog-tenant-id':tenantId, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
};
const emit = (environment: unknown = 'homologation') => request({
  action: 'emit', type: 'nfcom', emitterId: 'emitter',
  body: { environment, emitterCnpj: '12345678000199', externalId: 'stable-document', payload: {} },
});

beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: (name: string) => state.env[name] }, serve: (handler: typeof state.handler) => { state.handler = handler; } });
  const proxyPath = '../../supabase/functions/hub-fiscal-proxy/index.ts';
  await import(proxyPath);
});
beforeEach(() => {
  fetcher.mockReset().mockImplementation(() => Promise.resolve(
    new Response(JSON.stringify({ document: { id: 'hub-document', status: 'processing' } }), { status: 200 }),
  ));
  vi.stubGlobal('fetch', fetcher);
  state.inserts = [];
  state.tables = {
    tenant_memberships: [{ tenant_id: tenantId, user_id: 'user', active: true, role: 'operator' }],
    tenant_emitters: [{ id: 'emitter', tenant_id: tenantId, cnpj: '12345678000199', active: true }],
    hub_fiscal_credentials: [credential('production')],
    hub_fiscal_emissions: [],
    nfse_documents: [
      { id: 'nfse-1', tenant_id: tenantId, emitter_id: 'emitter', fiscal_document_ids: ['source-1'], cancelled: false, is_preview: false },
      { id: 'nfse-2', tenant_id: tenantId, emitter_id: 'emitter', fiscal_document_ids: ['source-2'], cancelled: false, is_preview: false },
      { id: 'nfse-unified', tenant_id: tenantId, emitter_id: 'emitter', fiscal_document_ids: ['source-1', 'source-2'], cancelled: false, is_preview: false },
    ],
  };
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterAll(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('fiscal Edge handler environment isolation (no external requests)', () => {
  it('blocks homologation when only production credentials exist, even with a global key', async () => {
    const response = await emit();
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'HUB_CREDENTIAL_ENVIRONMENT_MISMATCH' } });
    expect(fetcher).not.toHaveBeenCalled();
    expect(state.inserts).toHaveLength(0);
  });
  it('uses and persists homologation exactly when that credential exists', async () => {
    state.tables.hub_fiscal_credentials.push(credential('homologation', 'nfcom'));
    expect((await emit()).status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer homologation-scoped' });
    expect(state.inserts[0]).toMatchObject({ environment: 'homologation', emitter_id: 'emitter', doc_type: 'nfcom' });
  });
  it.each([null, '', 'invalid'])('blocks an absent or invalid environment %s', async environment => {
    expect((await emit(environment)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not fall back when the selected credential has no token', async () => {
    state.tables.hub_fiscal_credentials = [{ ...credential('homologation'), secret_name: null }];
    expect((await emit()).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preserves operator CFOP 5352 for an intrastate production CT-e', async () => {
    state.tables.tenant_emitters[0].endereco = {uf:'MG',municipio:'Montes Claros',codigo_municipio:'3143302'};
    const response = await request({action:'emit',type:'cte',emitterId:'emitter',body:{
      environment:'production',emitterCnpj:'12345678000199',externalId:'qa-cfop-5352',
      payload:{CFOP:'5352',inicio:{uf:'MG',municipio:'Montes Claros',codigoMunicipio:'3143302'},
        fim:{uf:'MG',municipio:'Coracao de Jesus',codigoMunicipio:'3118802'}},
    }});
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
    const sent = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(sent.environment).toBe('production');
    expect(sent.payload.CFOP).toBe('5352');
    expect(sent.payload.ide.CFOP).toBe('5352');
  });
  it('rejects CNPJ mismatch before contacting the Hub', async () => {
    const response = await request({ action: 'emit', type: 'cte', emitterId: 'emitter', body: {
      environment: 'production', emitterCnpj: '99999999000199', externalId: 'stable', payload: {},
    } });
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('derives environment and document scope for existing document reads', async () => {
    state.tables.hub_fiscal_credentials = [credential('homologation', 'cte')];
    state.tables.hub_fiscal_emissions = [{ id: 'emission', tenant_id: tenantId, emitter_id: 'emitter', environment: 'homologation', doc_type: 'cte', hub_document_id: 'hub-document' }];
    expect((await request({ action: 'get', id: 'hub-document', emissionId: 'emission' })).status).toBe(200);
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer homologation-scoped' });
  });
  it('allows historical reads from an inactive emitter using the stored environment', async () => {
    state.tables.tenant_emitters[0].active = false;
    state.tables.hub_fiscal_credentials = [credential('homologation', 'cte')];
    state.tables.hub_fiscal_emissions = [{ id: 'emission', tenant_id: tenantId, emitter_id: 'emitter', environment: 'homologation', doc_type: 'cte', hub_document_id: 'hub-document' }];
    expect((await request({ action: 'get', id: 'hub-document', emissionId: 'emission' })).status).toBe(200);
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer homologation-scoped' });
  });
  it('blocks new emissions from an inactive emitter', async () => {
    state.tables.tenant_emitters[0].active = false;
    expect((await emit('production')).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not allow an inactive emitter to read an unlinked document', async () => {
    state.tables.tenant_emitters[0].active = false;
    expect((await request({ action: 'get', id: 'unknown', emitterId: 'emitter', environment: 'production' })).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not let the delivery body override the authorized document', async () => {
    state.tables.hub_fiscal_emissions = [{ id: 'emission', tenant_id: tenantId, emitter_id: 'emitter', environment: 'production', doc_type: 'cte', hub_document_id: 'hub-document' }];
    expect((await request({ action: 'deliver', id: 'hub-document', emissionId: 'emission', body: { id: 'other-document', idIntegracao: 'other-integration' } })).status).toBe(200);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ id: 'hub-document' });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).not.toHaveProperty('idIntegracao');
  });
  it.each([
    { environment: 'production' }, { type: 'nfse' }, { id: 'different-hub-document' },
  ])('rejects conflicting document routing %j', async override => {
    state.tables.hub_fiscal_emissions = [{ id: 'emission', tenant_id: tenantId, emitter_id: 'emitter', environment: 'homologation', doc_type: 'cte', hub_document_id: 'hub-document' }];
    expect((await request({ action: 'get', id: 'hub-document', emissionId: 'emission', ...override })).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects a tenant outside the user memberships', async () => {
    state.tables.tenant_emitters[0].tenant_id = otherTenantId;
    expect((await emit()).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('dispatches individual NFS-e sequentially with one stable idempotency key per local document', async () => {
    state.tables.hub_fiscal_credentials.push(credential('homologation', 'nfse'));
    const response = await request({
      action: 'emit-nfse-batch', batchMode: 'individual', requestId: 'batch-command-1',
      emitterId: 'emitter', environment: 'homologation',
      entries: ['nfse-1', 'nfse-2'].map(nfseDocumentId => ({
        nfseDocumentId,
        body: { environment: 'homologation', emitterCnpj: '12345678000199', payload: { aliquota: 2 } },
      })),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true, partial: false, mode: 'individual', requestId: 'batch-command-1',
      results: [{ nfseDocumentId: 'nfse-1', success: true }, { nfseDocumentId: 'nfse-2', success: true }],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(call => JSON.parse(String(call[1]?.body)).idIntegracao))
      .toEqual(['agvlog-nfse-nfse-1', 'agvlog-nfse-nfse-2']);
  });

  it('validates every NFS-e source cardinality before the first provider request', async () => {
    state.tables.hub_fiscal_credentials.push(credential('homologation', 'nfse'));
    const response = await request({
      action: 'emit-nfse-batch', batchMode: 'individual', requestId: 'batch-invalid',
      emitterId: 'emitter', environment: 'homologation',
      entries: [{
        nfseDocumentId: 'nfse-unified',
        body: { environment: 'homologation', emitterCnpj: '12345678000199', payload: {} },
      }],
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'NFSE_BATCH_SOURCE_CARDINALITY_INVALID' } });
    expect(fetcher).not.toHaveBeenCalled();
    expect(state.inserts).toHaveLength(0);
  });

  it('does not reserve NFS-e sources when the selected environment has no credential', async () => {
    const response = await request({
      action: 'emit-nfse-batch', batchMode: 'individual', requestId: 'batch-without-credential',
      emitterId: 'emitter', environment: 'homologation',
      entries: [{
        nfseDocumentId: 'nfse-1',
        body: { environment: 'homologation', emitterCnpj: '12345678000199', payload: {} },
      }],
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'HUB_CREDENTIAL_ENVIRONMENT_MISMATCH' } });
    expect(fetcher).not.toHaveBeenCalled();
    expect(state.inserts).toHaveLength(0);
  });

  it('does not reserve NFS-e sources when one entry has a conflicting route', async () => {
    state.tables.hub_fiscal_credentials.push(credential('homologation', 'nfse'));
    const response = await request({
      action: 'emit-nfse-batch', batchMode: 'individual', requestId: 'batch-route-mismatch',
      emitterId: 'emitter', environment: 'homologation',
      entries: [
        { nfseDocumentId: 'nfse-1', body: { environment: 'homologation', emitterCnpj: '12345678000199', payload: {} } },
        { nfseDocumentId: 'nfse-2', body: { environment: 'production', emitterCnpj: '12345678000199', payload: {} } },
      ],
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'NFSE_BATCH_ROUTE_MISMATCH', nfseDocumentId: 'nfse-2' } });
    expect(fetcher).not.toHaveBeenCalled();
    expect(state.inserts).toHaveLength(0);
  });

  it('accepts one unified NFS-e linked to every selected source', async () => {
    state.tables.hub_fiscal_credentials.push(credential('homologation', 'nfse'));
    const response = await request({
      action: 'emit-nfse-batch', batchMode: 'unified', requestId: 'batch-unified',
      emitterId: 'emitter', environment: 'homologation',
      entries: [{
        nfseDocumentId: 'nfse-unified',
        body: { environment: 'homologation', emitterCnpj: '12345678000199', payload: { total: 200 } },
      }],
    });
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('reports a partial individual batch as 207 without claiming rollback', async () => {
    state.tables.hub_fiscal_credentials.push(credential('homologation', 'nfse'));
    fetcher
      .mockResolvedValueOnce(new Response(JSON.stringify({ document: { id: 'hub-1', status: 'processing' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ document: { id: 'hub-2', status: 'rejected' }, error: { code: 'MOCK_REJECTED' } }), { status: 422 }));
    const response = await request({
      action: 'emit-nfse-batch', batchMode: 'individual', requestId: 'batch-partial',
      emitterId: 'emitter', environment: 'homologation',
      entries: ['nfse-1', 'nfse-2'].map(nfseDocumentId => ({
        nfseDocumentId,
        body: { environment: 'homologation', emitterCnpj: '12345678000199', payload: {} },
      })),
    });
    expect(response.status).toBe(207);
    const body = await response.json();
    expect(body).toMatchObject({ success: false, partial: true });
    expect(body).not.toHaveProperty('rolledBack');
    expect(body.results).toMatchObject([
      { nfseDocumentId: 'nfse-1', success: true },
      { nfseDocumentId: 'nfse-2', success: false },
    ]);
  });

  it('retries an already completed batch with provider reads and no duplicate POST', async () => {
    state.tables.hub_fiscal_credentials.push(credential('homologation', 'nfse'));
    const payload = {
      action: 'emit-nfse-batch', batchMode: 'individual', requestId: 'batch-replay',
      emitterId: 'emitter', environment: 'homologation',
      entries: ['nfse-1', 'nfse-2'].map(nfseDocumentId => ({
        nfseDocumentId,
        body: { environment: 'homologation', emitterCnpj: '12345678000199', payload: {} },
      })),
    };
    expect((await request(payload)).status).toBe(200);
    expect((await request(payload)).status).toBe(200);
    expect(fetcher.mock.calls.map(call => call[1]?.method)).toEqual(['POST', 'POST', 'GET', 'GET']);
  });

  it('never retries a POST for an uncertain batch item without reconciliation', async () => {
    state.tables.hub_fiscal_credentials.push(credential('homologation', 'nfse'));
    fetcher.mockRejectedValueOnce(new Error('timeout'));
    const payload = {
      action: 'emit-nfse-batch', batchMode: 'individual', requestId: 'batch-uncertain',
      emitterId: 'emitter', environment: 'homologation',
      entries: [{
        nfseDocumentId: 'nfse-1',
        body: { environment: 'homologation', emitterCnpj: '12345678000199', payload: {} },
      }],
    };
    expect((await request(payload)).status).toBe(207);
    expect((await request(payload)).status).toBe(207);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]?.method).toBe('POST');
  });

});


describe('actual proxy handler CORS entrypoint', () => {
  const preview = 'https://agvlog-preview-thomaz-20260831.veituma.chatgpt.site';
  it('accepts preview preflight and returns a readable 401 without authentication', async () => {
    for (const method of ['OPTIONS', 'POST']) {
      const response = await state.handler!(new Request('https://edge.example.test', { method, headers: { Origin: preview } }));
      expect(response.status).toBe(method === 'OPTIONS' ? 200 : 401);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(preview);
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(state.inserts).toHaveLength(0);
  });
  it('rejects another hosted site before any Hub call or durable intent', async () => {
    const response = await state.handler!(new Request('https://edge.example.test', { method: 'POST', headers: { Origin: 'https://other.veituma.chatgpt.site', Authorization: 'Bearer user-token' }, body: JSON.stringify({action:'emit'}) }));
    expect(response.status).toBe(403);
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(state.inserts).toHaveLength(0);
  });
});
