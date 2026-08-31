import {useEffect} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {z} from 'zod';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {supabase} from '@/integrations/supabase/client';
import {rowSchema} from '@/lib/financial/expenseReviewCommands';
const page=z.object({version:z.literal(1),tenant_id:z.string().uuid(),actor_id:z.string().uuid(),offset:z.number().int().nonnegative(),total:z.number().int().nonnegative()});
const historySchema=page.extend({rows:z.array(rowSchema).max(50)}).strict();
const sourcesSchema=page.extend({rows:z.array(z.object({id:z.string().uuid(),driver_id:z.string().uuid(),status:z.enum(['planned','in_transit','completed']),
 notes:z.string().nullable(),created_at:z.string(),actual_start_at:z.string().nullable(),actual_end_at:z.string().nullable()})).max(50)}).strict();
function useScope(){const {user}=useAuth(),{currentTenant}=useTenant();return {tenant:currentTenant?.id,actor:user?.id};}
export function useDriverExpenseHistory(offset:number){
 const {tenant,actor}=useScope(),client=useQueryClient();
 useEffect(()=>{if(!tenant||!actor)return;const channel=supabase.channel('driver-expense-history:'+tenant+':'+actor).on('postgres_changes',
  {event:'*',schema:'public',table:'driver_expenses',filter:'tenant_id=eq.'+tenant},()=>{void client.invalidateQueries({queryKey:['driver_expenses',tenant,actor]});}).subscribe();
  return()=>{void supabase.removeChannel(channel);};},[tenant,actor,client]);
 return useQuery({queryKey:['driver_expenses',tenant,actor,offset],enabled:!!tenant&&!!actor,retry:false,queryFn:async({signal})=>{
  const {data,error}=await supabase.rpc('list_driver_expenses',{_tenant_id:tenant!,_offset:offset}).abortSignal(signal);if(error)throw error;
  const p=historySchema.parse(data);if(p.tenant_id!==tenant||p.actor_id!==actor||p.offset!==offset||p.rows.some(row=>row.tenant_id!==tenant))throw new Error('Lista de despesas incompatível com a sessão.');return p;
 }});
}
export function useDriverExpenseSources(offset:number,enabled:boolean){
 const {tenant,actor}=useScope();
 return useQuery({queryKey:['driver-expense-sources',tenant,actor,offset],enabled:enabled&&!!tenant&&!!actor,retry:false,queryFn:async({signal})=>{
  const {data,error}=await supabase.rpc('list_driver_expense_sources',{_tenant_id:tenant!,_offset:offset}).abortSignal(signal);if(error)throw error;
  const p=sourcesSchema.parse(data);if(p.tenant_id!==tenant||p.actor_id!==actor||p.offset!==offset)throw new Error('Viagens incompatíveis com a sessão.');return p;
 }});
}
