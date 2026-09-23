import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';

export interface OperationsDashboardSummary{
  timezone:string;today:string;pending_orders:number;delayed_orders:number;
  orders_by_status:Array<{status:string;count:number}>;delayed_order_rows:Array<{id:string;order_number:string;promised_date:string;status:string;days_overdue:number;clients:{company_name:string|null}|null}>;
  active_loads:number;in_transit_loads:number;delivery_success_rate:number|null;
  open_incidents:number;critical_incidents:number;incident_cost:number;incident_rows:Array<{id:string;incident_number:string;title:string;severity:string;status:string}>;
  open_maintenance:number;maintenance_cost:number;maintenance_rows:Array<{id:string;order_number:string;total_cost:number|null;status:string;vehicles:{plate:string|null}|null}>;
  expiring_docs:number;low_stock:number;vehicle_occupancy_rows:Array<{id:string;plate:string;nickname:string|null;max_pallets:number;loaded_pallets:number;occupancy:number}>;
}

export function useOperationsDashboardSummary(){const {currentTenant}=useTenant();return useQuery({queryKey:['operations_dashboard_summary',currentTenant?.id],enabled:!!currentTenant,queryFn:async()=>{if(!currentTenant)throw new Error('Tenant não selecionado');const {data,error}=await (supabase.rpc.bind(supabase) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>)('operations_dashboard_summary_v1',{_tenant_id:currentTenant.id});if(error)throw error;return data as OperationsDashboardSummary;}});}
