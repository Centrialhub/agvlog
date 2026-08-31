import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {cleanup,renderHook,waitFor} from '@testing-library/react';
import type {PropsWithChildren} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useCteSearch,type CteSearchFilters} from '@/hooks/useCteSearch';
import {readCtePayloadInvoiceNumbers} from '@/lib/fiscal/ctePayload';

type Row=Record<string,unknown>;
const state=vi.hoisted(()=>({rows:{} as Record<string,Row[]>, failTable:''}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'tenant'}})}));
vi.mock('@/integrations/supabase/client',async()=>{
  const {createClient}=await import('@supabase/supabase-js');
  const fetchFixture:typeof fetch=async input=>{
    const url=new URL(String(input));const table=url.pathname.split('/').pop()!;
    if(state.failTable===table)return new Response(JSON.stringify({message:'consulta indisponivel'}),{status:500});
    let rows=state.rows[table]||[];
    for(const [field,expression] of url.searchParams){
      if(['select','order','offset','limit'].includes(field))continue;
      rows=rows.filter(row=>{
        if(expression.startsWith('eq.'))return String(row[field])===expression.slice(3);
        if(expression==='is.null')return row[field]==null;
        if(expression.startsWith('ilike.'))return String(row[field]||'').includes(expression.slice(7,-1));
        throw new Error('Unhandled query '+field+' '+expression);
      });
    }
    const start=Number(url.searchParams.get('offset')||0),limit=Math.min(Number(url.searchParams.get('limit')||1000),1000);
    return new Response(JSON.stringify(rows.slice(start,start+limit)),{status:200});
  };
  return {supabase:createClient('https://fixture.invalid','test-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:fetchFixture}})};
});
let client:QueryClient;
function Wrapper({children}:PropsWithChildren){return <QueryClientProvider client={client}>{children}</QueryClientProvider>;}
const outbound=(id:string,overrides:Row={}):Row=>({id,tenant_id:'tenant',document_type:'outbound',deleted_at:null,is_duplicate:false,
  invoice_number:'cte-internal-reference-'+id,status:'authorized',sefaz_status:'authorized',access_key:'key-'+id,
  created_at:'2026-08-15T12:00:00Z',cte_payload:{payload:{notasFiscais:[{numero:'443663'},{numero:'443664'}]}},...overrides});
const receipt=(id:string,overrides:Row={}):Row=>({id:'receipt-'+id,tenant_id:'tenant',doc_type:'cte',fiscal_document_id:id,number:'234',series:'1',...overrides});
beforeEach(()=>{state.rows={cte_documents:[],fiscal_documents:[outbound('old')],hub_fiscal_emissions:[receipt('old')]};state.failTable='';
  client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});});
afterEach(()=>{cleanup();client.clear();});

it.each<CteSearchFilters>([{text:'443663'},{invoiceNumber:'443663'},{docNumber:'443663'},{docNumber:'234'},{invoiceNumber:'443664'}])('finds the legacy CT-e by NF or fiscal number: %j',async filters=>{
  const {result}=renderHook(()=>useCteSearch(filters),{wrapper:Wrapper});
  await waitFor(()=>expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toHaveLength(1);
  expect(result.current.data?.[0]).toMatchObject({id:'old',cte_number:'234',invoice_numbers:'443663, 443664'});
});
it('enriches a catalog row with blank NF text before filtering and merges it only once',async()=>{
  state.rows.cte_documents=[{id:'old',tenant_id:'tenant',cte_number:'234',invoice_numbers:null,access_key:'key-old',created_at:'2026-08-15'}];
  const {result}=renderHook(()=>useCteSearch({invoiceNumber:'443663'}),{wrapper:Wrapper});
  await waitFor(()=>expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toHaveLength(1);
  expect(result.current.data?.[0]).toMatchObject({source:'hub',invoice_numbers:'443663, 443664'});
});
it('retains cancelled history and a new issuance without depending on current source links, excluding other tenants',async()=>{
  state.rows.fiscal_documents=[outbound('old',{status:'cancelled'}),outbound('new'),outbound('foreign',{tenant_id:'other'})];
  state.rows.hub_fiscal_emissions=[receipt('old'),receipt('new',{number:'320'}),receipt('foreign',{tenant_id:'other'})];
  const {result}=renderHook(()=>useCteSearch({invoiceNumber:'443663'}),{wrapper:Wrapper});
  await waitFor(()=>expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.map(r=>[r.cte_number,r.sefaz_status])).toEqual([['234','cancelled'],['320','processed']]);
});
it('finds documents beyond the API row cap',async()=>{
  state.rows.fiscal_documents=[...Array.from({length:1001},(_,i)=>outbound(String(i),{cte_payload:null})),outbound('old')];
  state.rows.hub_fiscal_emissions=[...Array.from({length:1001},(_,i)=>receipt(String(i))),receipt('old')];
  const {result}=renderHook(()=>useCteSearch({invoiceNumber:'443663'}),{wrapper:Wrapper});
  await waitFor(()=>expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.map(r=>r.cte_number)).toEqual(['234']);
});
it('reports receipt-query failure instead of a misleading empty result',async()=>{
  state.failTable='hub_fiscal_emissions';
  const {result}=renderHook(()=>useCteSearch({invoiceNumber:'443663'}),{wrapper:Wrapper});
  await waitFor(()=>expect(result.current.isError).toBe(true));
});
it('reads numeric/string NF numbers, deduplicates, and tolerates missing/malformed payloads',()=>{
  expect(readCtePayloadInvoiceNumbers({payload:{notasFiscais:[{numero:443663},{numero:'443663'},null,{numero:' 443664 '}]}})).toBe('443663, 443664');
  expect(readCtePayloadInvoiceNumbers({payload:{notasFiscais:'invalid'}})).toBeNull();
  expect(readCtePayloadInvoiceNumbers(null)).toBeNull();
});
