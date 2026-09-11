import {act,renderHook} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {describe,it,expect,vi} from 'vitest';
import type {ReactNode} from 'react';
const state=vi.hoisted(()=>({calls:[] as {table:string;payload:unknown}[]}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'tenant'}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'actor'}})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:(table:string)=>{
 if(table==='tenant_emitters')return {select:()=>{const chain:any={eq:()=>chain,maybeSingle:async()=>({data:{id:'emitter',razao_social:'Emitente QA',nome_fantasia:null,cnpj:'11111111000111'},error:null})};return chain;}};
 if(table==='cte_batches')return {insert:(payload:unknown)=>{state.calls.push({table,payload});return {select:()=>({single:async()=>({data:{id:'batch'},error:null})})};}};
 if(table==='cte_documents')return {insert:async(payload:unknown)=>{state.calls.push({table,payload});return {error:null};},
  select:()=>({eq:async()=>({data:[{id:'draft-document',client_id:'client',freight_value:200,recipient:'Destino'}],error:null})})};
 if(table==='receivables')return {upsert:async(payload:unknown)=>{state.calls.push({table,payload});return {error:null};}};
 throw new Error(`Unexpected request to ${table}`);
}}}));
import {useCreateCteBatch} from '../hooks/useBilling';
describe('draft CT-e batches are not receivables',()=>{
 it('creates the batch and drafts without touching the receivables ledger',async()=>{
  const client=new QueryClient({defaultOptions:{mutations:{retry:false}}});
  const hook=renderHook(()=>useCreateCteBatch(),{wrapper:({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
  await act(async()=>{await hook.result.current.mutateAsync({client_id:'client',grouping_mode:1,source_type:'loads',fiscal_document_ids:[],groups:[{
   key:'group',client_id:'client',remitter:null,documents:[],recipient:'Destino',recipient_city:'Cidade',recipient_state:'SP',load_ids:[],fiscal_document_ids:[],invoice_count:1,pallet_count:0,weight_kg:100,cargo_value:1000,freight_value:200,
  }]});});
  expect(state.calls.map(c=>c.table)).toEqual(['cte_batches','cte_documents']);
  expect(state.calls[1].payload).toEqual([expect.objectContaining({status:'draft',freight_value:200})]);
 });
});
