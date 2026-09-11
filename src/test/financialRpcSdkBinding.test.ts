import {beforeEach,expect,it,vi} from 'vitest';
import {readCashForecastAgenda} from '@/lib/financial/cashForecastAgendaClient';
import {readCashForecastPreview} from '@/lib/financial/cashForecastViewClient';
import {readCostDispositionReturn} from '@/lib/financial/costDispositionReturnClient';
import {readOpenComplementExtinction} from '@/lib/financial/openComplementExtinctionClient';
import {readPayableApproval} from '@/lib/financial/payableApprovalClient';
import {readUnloadingOpenComplement} from '@/lib/financial/unloadingOpenComplementClient';
import {readUnloadingCostRegularization} from '@/lib/financial/unloadingCostRegularizationClient';
const state=vi.hoisted(()=>({fetch:vi.fn()}));
vi.mock('@/integrations/supabase/client',async()=>{
 const {createClient}=await import('@supabase/supabase-js');
 return {supabase:createClient('https://financial-rpc.invalid','isolated-test-publishable-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:state.fetch}})};
});
const tenant='10000000-0000-4000-8000-000000000001',actor='20000000-0000-4000-8000-000000000001',id='30000000-0000-4000-8000-000000000001';
const rejection={code:'QA_TRANSPORT',message:'Isolated transport reached',details:null,hint:null};
beforeEach(()=>{state.fetch.mockReset();state.fetch.mockImplementation(async()=>new Response(JSON.stringify(rejection),{status:400,headers:{'Content-Type':'application/json'}}));});
const cases:Array<[string,()=>Promise<unknown>]>= [
 ['preview_finance_cash_forecast_agenda',()=>readCashForecastAgenda(tenant,actor,'2026-09-11','2026-10-11','receivable:'+id)],
 ['preview_finance_cash_forecast',()=>readCashForecastPreview(tenant,actor,'2026-09-11','2026-10-11')],
 ['preview_finance_cost_disposition_return',()=>readCostDispositionReturn(tenant,actor,id,id,'100')],
 ['preview_finance_open_complement_extinction',()=>readOpenComplementExtinction(tenant,actor,id,{amount_cents:'100',dispositions:[]})],
 ['preview_finance_payable_approval',()=>readPayableApproval(tenant,actor,id)],
 ['preview_finance_unloading_open_complement',()=>readUnloadingOpenComplement(tenant,actor,id,'100')],
 ['preview_finance_unloading_cost_regularization',()=>readUnloadingCostRegularization(tenant,actor,id,{amount_cents:'100',dispositions:[]})],
];
it.each(cases)('uses the actual SDK transport and company payload for %s',async(name,invoke)=>{
 await expect(invoke()).rejects.toMatchObject(rejection);
 expect(state.fetch).toHaveBeenCalledOnce();
 const [url,options]=state.fetch.mock.calls[0] as [string,RequestInit];
 expect(String(url)).toBe('https://financial-rpc.invalid/rest/v1/rpc/'+name);
 expect(options.method).toBe('POST');
 expect(JSON.parse(String(options.body))).toMatchObject({_tenant_id:tenant});
});