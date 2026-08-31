import {useQuery} from '@tanstack/react-query';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import type {FreightAllocation} from '@/lib/closingReports/closingReportBuilder';
import {closingSourceFilterSchema,parseClosingSources,closingSourceError} from '@/lib/closingReports/closingSources';
import {buildClosingAttemptPreview} from '@/lib/closingReports/closingAttemptPreview';
// Read-only candidate. Do not wire its preview to the legacy, multi-request
// report creator: the write cutover requires a server-side revision contract.
export function useClosingSourcePreview(input:unknown,options:{allocation?:FreightAllocation;onlyWithCte?:boolean}={}){
 const {user}=useAuth();const {currentTenant}=useTenant();const actor=user?.id;const tenant=currentTenant?.id;
 const parsed=closingSourceFilterSchema.safeParse(input);const filters=parsed.success?parsed.data:null;
 const query=useQuery({queryKey:['closing-source-preview',tenant,actor,filters,options],enabled:!!tenant&&!!actor&&!!filters,
  retry:false,staleTime:0,
  queryFn:async({signal})=>{
   if(!tenant||!actor||!filters)throw new Error('Selecione uma empresa e filtros válidos.');
   const controller=new AbortController();const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
   if(signal.aborted)controller.abort();const timer=setTimeout(abort,30000);
   try{
    const {data,error}=await supabase.rpc('get_closing_report_sources',{_tenant_id:tenant,_filters:filters}).abortSignal(controller.signal);
    if(error)throw error;if(controller.signal.aborted)throw new Error('Leitura interrompida. Consulte novamente.');
    const sources=parseClosingSources(data,{tenantId:tenant,actorId:actor,filters});return buildClosingAttemptPreview(sources,options);
   }catch(error){throw new Error(closingSourceError(error));}
   finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
  }});
 return {...query,contextError:!tenant||!actor?'Selecione uma empresa e entre com uma sessão válida.':!filters?'Informe um período válido de até 366 dias.':null};
}
