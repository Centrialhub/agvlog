import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
import {periodUnloadingFlowRequestSchema,periodUnloadingFlowSchema,type PeriodUnloadingFlowRequest} from './periodUnloadingFlowContract';

type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
export class PeriodUnloadingFlowChangedError extends Error{
 constructor(){super('As descargas ou suas evidências mudaram. Atualize a consulta para voltar à primeira página.');this.name='PeriodUnloadingFlowChangedError';}
}
export class PeriodUnloadingMoneyPackageChangedError extends Error{
 constructor(){super('A conferência de dinheiro mudou. Atualize o pacote do período antes de comparar as descargas.');this.name='PeriodUnloadingMoneyPackageChangedError';}
}
export async function readPeriodUnloadingFlow(request:PeriodUnloadingFlowRequest&{expectedMoneyPackageRevision:string}){
 const input=periodUnloadingFlowRequestSchema.parse(request);
 const expectedMoney=z.string().regex(/^[a-f0-9]{32}$/).parse(request.expectedMoneyPackageRevision);
 const {data,error}=await(supabase.rpc as unknown as Rpc)('get_finance_period_unloading_flow',{
  _tenant_id:input.tenantId,_from:input.from,_to:input.to,_account_ids:input.accountIds,_supplier_id:input.supplierId,_page:input.page,_expected_revision:input.expectedRevision,
 });
 if(error){if(typeof error==='object'&&'code' in error&&error.code==='40001')throw new PeriodUnloadingFlowChangedError();throw error;}
 const result=periodUnloadingFlowSchema.parse(data);
 if(result.tenant_id!==input.tenantId||result.period.from!==input.from||result.period.to!==input.to||result.supplier_id!==input.supplierId||result.page!==input.page
  ||result.account_scope.selected_ids.length!==input.accountIds.length||input.accountIds.some(id=>!result.account_scope.selected_ids.includes(id)))throw new Error('Demonstrativo fora da empresa, período, fornecedor ou contas solicitadas.');
 if(result.money_package_revision!==expectedMoney)throw new PeriodUnloadingMoneyPackageChangedError();
 if(input.expectedRevision!==null&&result.revision!==input.expectedRevision)throw new PeriodUnloadingFlowChangedError();
 return result;
}
