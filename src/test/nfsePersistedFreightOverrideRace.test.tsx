import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import NFSeFromInvoicesDialog from '@/components/nfse/NFSeFromInvoicesDialog';
import NFSeFormDialog from '@/components/nfse/NFSeFormDialog';
import { useOverrideFreightValue } from '@/hooks/useOverrideFreightValue';
import { useAutomaticInboundFreight } from '@/hooks/useAutomaticInboundFreight';
import { buildNFSeEmitPayload, type BuildNFSeInput } from '@/lib/fiscal/nfseBuilder';

const state = vi.hoisted(() => ({
  tenant: 'tenant', rows: [] as Record<string, unknown>[], writes: [] as string[], auditFailure:false,
  calculate: vi.fn(), create: vi.fn(), issue: vi.fn(),
  drafts: [] as BuildNFSeInput['doc'][], sent: [] as ReturnType<typeof buildNFSeEmitPayload>[],
  emitter: { id:'emitter', active:true, is_default:true, regime_tributario:'normal', cnpj:'11222333000181',
    razao_social:'Emitente QA', im:'123', city_code:'3106200', endereco:{uf:'MG',municipio:'Belo Horizonte',logradouro:'Rua QA',numero:'1',bairro:'Centro',cep:'30110000'} },
  clients: [{ id:'client',tax_id:'11222333000181',company_name:'Tomador QA',state_registration:'ISENTO',
    address_street:'Rua QA',address_number:'1',address_neighborhood:'Centro',address_city:'Belo Horizonte',address_city_ibge_code:'3106200',address_state:'MG',address_zip:'30110000' }],
}));
vi.mock('@/hooks/useTenant', () => ({useTenant:()=>({currentTenant:{id:state.tenant}})}));
vi.mock('@/hooks/useAuth', () => ({useAuth:()=>({user:{id:'actor'}})}));
vi.mock('@/hooks/useClients', () => ({useClients:()=>({data:state.clients})}));
vi.mock('@/hooks/useEmitters', () => ({useEmitters:()=>({data:[state.emitter]})}));
vi.mock('@/hooks/useSonnerToast', () => ({useSonnerToast:()=>({success:vi.fn(),error:vi.fn(),warning:vi.fn(),info:vi.fn()})}));
vi.mock('@/hooks/useInsuranceProfile', () => ({useInsuranceProfile:()=>({}),useUpdateInsuranceProfile:()=>({})}));
vi.mock('@/hooks/useRecalculateInboundFreight', () => ({useRecalculateInboundFreight:()=>({})}));
vi.mock('@/hooks/useFreightCalculator', () => ({calculateFreight:(...args:unknown[])=>state.calculate(...args)}));
vi.mock('@/hooks/useNFSe', () => ({useCreateNFSe:()=>({mutateAsync:state.create}),useUpdateNFSe:()=>({mutateAsync:state.create}),useIssueNFSeBatch:()=>({mutateAsync:state.issue})}));
// These fixtures use real React Query cache/refetch lifecycles. The mutation hook
// and the load query in NFSeFormDialog are the production implementations.
vi.mock('@/hooks/useBillingDocuments', async () => {
  const {useQuery}=await import('@tanstack/react-query');
  return {useBillingDocuments:()=>useQuery({queryKey:['billing_documents',state.tenant,'nfse'],queryFn:async()=>structuredClone(state.rows.filter(row=>row.tenant_id===state.tenant))})};
});
vi.mock('@/hooks/useFiscalDocuments', () => ({useFiscalDocuments:()=>({data:[],isFetching:false,dataUpdatedAt:1})}));
vi.mock('@/integrations/supabase/client', async () => {
  const {createClient}=await import('@supabase/supabase-js');
  const fixture:typeof fetch=async(input,init)=>{
    const url=new URL(String(input)); const table=url.pathname.split('/').pop();
    const predicates=[...url.searchParams].filter(([key])=>!['select','order','offset','limit'].includes(key));
    const rows=state.rows.filter(row=>predicates.every(([key,value])=>{
      if(value==='is.null')return row[key]==null;
      if(value.startsWith('eq.'))return String(row[key])===value.slice(3);
      if(value.startsWith('in.'))return value.slice(4,-1).split(',').includes(String(row[key]));
      throw new Error('Unsupported test filter '+value);
    }));
    if(init?.method==='PATCH'){
      expect(table).toBe('fiscal_documents');
      const patch=JSON.parse(String(init.body)); for(const row of rows)Object.assign(row,patch);
      state.writes.push('fiscal_documents'); return new Response(null,{status:204});
    }
    if(init?.method==='POST'){
      expect(table).toBe('freight_override_log'); state.writes.push('freight_override_log');
      if(state.auditFailure)return new Response(JSON.stringify({message:'Audit unavailable'}),{status:500});
      return new Response(null,{status:201});
    }
    return new Response(JSON.stringify(table==='fiscal_documents'?rows:[]),{status:200});
  };
  return {supabase:createClient('https://fixture.invalid','test-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:fixture}})};
});
const source=(tenant='tenant')=>({id:'source-'+tenant,tenant_id:tenant,invoice_number:'1',value:9876.54,
  freight_value:null,freight_overridden:false,load_id:'load',document_type:'inbound',deleted_at:null,
  cte_emitted_at:null,nfse_emitted_document_id:null,client_id:'client',weight_kg:40,pallet_count:1,
  recipient:'Tomador QA',recipient_city:'Belo Horizonte',recipient_state:'MG',recipient_cnpj:'11222333000181',
  remitter:'Tomador QA',remitter_cnpj:'11222333000181',access_key:'29260614998371003215550000004411101880763851'});
let client:QueryClient;
function Wrapper({children}:PropsWithChildren){return <QueryClientProvider client={client}>{children}</QueryClientProvider>;}
beforeEach(()=>{
  vi.clearAllMocks();sessionStorage.clear();state.tenant='tenant';state.rows=[source()];state.writes=[];state.drafts=[];state.sent=[];state.auditFailure=false;
  client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  state.create.mockImplementation(async(doc:BuildNFSeInput['doc'])=>{
    const saved={...doc,id:'10000000-0000-4000-8000-000000000001',rps_number:'1'};state.drafts.push(saved);return saved;
  });
  state.issue.mockImplementation(async()=>{
    state.sent=state.drafts.map(doc=>buildNFSeEmitPayload({doc,emitter:state.emitter as BuildNFSeInput['emitter'],environment:'production'}));
    return {success:true,results:[]};
  });
});
afterEach(()=>{cleanup();client.clear();});
const click=(name:string|RegExp)=>userEvent.click(screen.getByRole('button',{name}));

it.each(['wizard','load form'] as const)('propagates a real persisted override while automatic calculation is delayed in %s',async form=>{
  let release!:(value:unknown)=>void;state.calculate.mockReturnValue(new Promise(resolve=>{release=resolve;}));
  const override=renderHook(()=>useOverrideFreightValue(),{wrapper:Wrapper});
  render(form==='wizard'?<NFSeFromInvoicesDialog open onOpenChange={()=>{}}/>:<NFSeFormDialog open loadId="load" onOpenChange={()=>{}}/>,{wrapper:Wrapper});
  if(form==='wizard')await userEvent.click(await screen.findByRole('checkbox',{name:'Selecionar NF 1'}));
  else{await screen.findByText('NF 1');await click('Selecionar Todas');}
  await waitFor(()=>expect(state.calculate).toHaveBeenCalledOnce());
  await act(async()=>{await override.result.current.mutateAsync({fiscalDocumentId:'source-tenant',newValue:42.42,reason:'Ajuste manual QA',previousValue:null,freightBreakdown:null});});
  if(form==='wizard'){
    await waitFor(()=>expect(screen.getByRole('button',{name:/Avançar/})).toBeEnabled());await click(/Avançar/);
    expect(screen.getByRole('spinbutton',{name:'Valor do serviço da NF 1'})).toHaveValue(42.42);
  }else{
    await userEvent.click(screen.getByRole('tab',{name:'Itens / Valores'}));
    await waitFor(()=>expect(within(screen.getAllByRole('row')[1]).getAllByRole('spinbutton')[1]).toHaveValue(42.42));
  }
  await act(async()=>{release({success:true,value:80,breakdown:null});});
  if(form==='wizard'){
    expect(screen.getByRole('spinbutton',{name:'Valor do serviço da NF 1'})).toHaveValue(42.42);
    await click(/Avançar/);await click('Emitir NFS-e');await waitFor(()=>expect(state.sent).toHaveLength(1));
    expect(state.sent[0].payload.servico[0].valor.servico).toBe(42.42);
  }else{await click('Criar RPS (rascunho)');await waitFor(()=>expect(state.drafts[0].valor_servicos).toBe(42.42));}
  expect(state.writes).toEqual(['fiscal_documents','freight_override_log']);
});

it.each(['wizard','load form'] as const)('blocks a real persisted zero override after a delayed automatic response in %s',async form=>{
  let release!:(value:unknown)=>void;state.calculate.mockReturnValue(new Promise(resolve=>{release=resolve;}));
  const override=renderHook(()=>useOverrideFreightValue(),{wrapper:Wrapper});
  render(form==='wizard'?<NFSeFromInvoicesDialog open onOpenChange={()=>{}}/>:<NFSeFormDialog open loadId="load" onOpenChange={()=>{}}/>,{wrapper:Wrapper});
  if(form==='wizard')await userEvent.click(await screen.findByRole('checkbox',{name:'Selecionar NF 1'}));
  else{await screen.findByText('NF 1');await click('Selecionar Todas');}
  await waitFor(()=>expect(state.calculate).toHaveBeenCalledOnce());
  await act(async()=>{await override.result.current.mutateAsync({fiscalDocumentId:'source-tenant',newValue:0,reason:'Ajuste manual QA',previousValue:null,freightBreakdown:null});});
  await act(async()=>{release({success:true,value:80,breakdown:null});});
  if(form==='wizard'){
    await waitFor(()=>expect(screen.getByRole('button',{name:/Avançar/})).toBeEnabled());await click(/Avançar/);
    expect(screen.getByRole('spinbutton',{name:'Valor do serviço da NF 1'})).toHaveValue(0);
    expect(screen.getByRole('button',{name:/Avançar/})).toBeDisabled();
  }else{
    await userEvent.click(screen.getByRole('tab',{name:'Itens / Valores'}));
    await waitFor(()=>expect(within(screen.getAllByRole('row')[1]).getAllByRole('spinbutton')[1]).toHaveValue(0));
    await click('Criar RPS (rascunho)');
  }
  expect(state.create).not.toHaveBeenCalled();expect(state.issue).not.toHaveBeenCalled();
});

it.each([['wizard',42.42],['load form',42.42],['wizard',0],['load form',0]] as const)('refreshes %s to persisted manual %s even when the subsequent audit insert fails',async(form,value)=>{
  let release!:(value:unknown)=>void;state.calculate.mockReturnValue(new Promise(resolve=>{release=resolve;}));state.auditFailure=true;
  const override=renderHook(()=>useOverrideFreightValue(),{wrapper:Wrapper});
  render(form==='wizard'?<NFSeFromInvoicesDialog open onOpenChange={()=>{}}/>:<NFSeFormDialog open loadId="load" onOpenChange={()=>{}}/>,{wrapper:Wrapper});
  if(form==='wizard')await userEvent.click(await screen.findByRole('checkbox',{name:'Selecionar NF 1'}));
  else{await screen.findByText('NF 1');await click('Selecionar Todas');}
  await waitFor(()=>expect(state.calculate).toHaveBeenCalledOnce());
  await act(async()=>{await expect(override.result.current.mutateAsync({fiscalDocumentId:'source-tenant',newValue:value,reason:'Ajuste manual QA',previousValue:null,freightBreakdown:null})).rejects.toMatchObject({message:'Audit unavailable'});});
  await act(async()=>{release({success:true,value:80,breakdown:null});});
  if(form==='wizard'){
    await waitFor(()=>expect(screen.getByRole('button',{name:/Avançar/})).toBeEnabled());await click(/Avançar/);
    expect(screen.getByRole('spinbutton',{name:'Valor do serviço da NF 1'})).toHaveValue(value);
    if(value===0)expect(screen.getByRole('button',{name:/Avançar/})).toBeDisabled();
    else{await click(/Avançar/);await click('Emitir NFS-e');await waitFor(()=>expect(state.sent[0].payload.servico[0].valor.servico).toBe(value));}
  }else{
    await userEvent.click(screen.getByRole('tab',{name:'Itens / Valores'}));
    await waitFor(()=>expect(within(screen.getAllByRole('row')[1]).getAllByRole('spinbutton')[1]).toHaveValue(value));
    await click('Criar RPS (rascunho)');if(value>0)await waitFor(()=>expect(state.drafts[0].valor_servicos).toBe(value));
  }
  if(value===0){expect(state.create).not.toHaveBeenCalled();expect(state.issue).not.toHaveBeenCalled();}
});

it('rejects an old tenant response and only accepts the new tenant calculation',async()=>{
  let release!:(value:unknown)=>void;
  state.calculate.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;})).mockResolvedValue({success:true,value:120,breakdown:null});
  const hook=renderHook(({doc})=>useAutomaticInboundFreight([doc],true),{initialProps:{doc:source()}});
  await waitFor(()=>expect(state.calculate).toHaveBeenCalledOnce());
  state.tenant='other';hook.rerender({doc:source('other')});
  await waitFor(()=>expect(hook.result.current.values).toEqual({'source-other':120}));
  await act(async()=>{release({success:true,value:80,breakdown:null});});
  expect(hook.result.current.values).toEqual({'source-other':120});expect(hook.result.current.pending).toBe(false);
});
