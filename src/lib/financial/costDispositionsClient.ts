import {supabase} from '@/integrations/supabase/client';
import {costDispositionsSchema} from './costDispositionsContract';
type Rpc=(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>;
export class CostDispositionsChangedError extends Error{}
export async function readCostDispositions(tenant:string,page:number,revision:string|null){const {data,error}=await (supabase.rpc as unknown as Rpc)('get_finance_cost_dispositions',{_tenant_id:tenant,_page:page,_expected_revision:revision});if(error){if(typeof error==='object'&&'code' in error&&error.code==='40001')throw new CostDispositionsChangedError('As pendências mudaram. A consulta voltou à primeira página.');throw error;}const result=costDispositionsSchema.parse(data);if(result.tenant_id!==tenant||result.page!==page||revision!==null&&result.revision!==revision)throw new Error('Pendências fora da consulta solicitada.');return result;}
