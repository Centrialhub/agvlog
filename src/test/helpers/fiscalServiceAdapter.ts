import type {SupabaseClient} from '@supabase/supabase-js';
import {serviceFiscal,type createFiscalReadinessDatabase} from './fiscalReadinessDatabase';
type Db=Awaited<ReturnType<typeof createFiscalReadinessDatabase>>['db'];
export function fiscalServiceAdapter(db:Db,options:{failConfirmation?:boolean}={}):SupabaseClient {
 const rpc=async(name:string,args:Record<string,unknown>)=>{
  try {
   if(name==='complete_hub_fiscal_emission'){
    if(options.failConfirmation){options.failConfirmation=false;return {data:null,error:{message:'simulated mirror failure'}};}
    const rows=await serviceFiscal<{result:unknown}>(db,'select complete_hub_fiscal_emission($1,$2,$3::jsonb,$4) result',[args._tenant,args._emission,JSON.stringify(args._response),args._http_status]);return {data:rows.rows[0].result,error:null};
   }
   if(name!=='claim_hub_fiscal_emission')throw new Error('unexpected RPC');
   const rows=await serviceFiscal<{result:unknown}>(db,'select claim_hub_fiscal_emission($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) result',
    [args._tenant,args._actor,args._emitter,args._type,args._environment,JSON.stringify(args._body),args._fiscal_id,args._cte_id,args._nfse_id]);
   return {data:rows.rows[0].result,error:null};
  }catch(error){return {data:null,error:{message:error instanceof Error?error.message:String(error)}};}
 };
 const from=(table:string)=>{
  if(table!=='hub_fiscal_emissions')throw new Error('unexpected table');
  const filters:Record<string,unknown>={};let update:Record<string,unknown>|null=null;
  const builder={select:()=>builder,eq:(k:string,v:unknown)=>{filters[k]=v;return builder;},update:(v:Record<string,unknown>)=>{update=v;return builder;},
   single:async()=>{
    try{const result=update?await serviceFiscal(db,'update hub_fiscal_emissions set hub_document_id=$3,last_response=case when $4::jsonb is null then last_response else $4::jsonb end where id=$1 and tenant_id=$2 returning *',
     [filters.id,filters.tenant_id,update.hub_document_id,update.last_response===undefined?null:JSON.stringify(update.last_response)]):await serviceFiscal(db,'select * from hub_fiscal_emissions where id=$1 and tenant_id=$2',[filters.id,filters.tenant_id]);
     return {data:result.rows[0],error:null};
    }catch(error){return {data:null,error:{message:String(error)}};}
   }};
  return builder;
 };
 return {rpc,from} as unknown as SupabaseClient;
}

