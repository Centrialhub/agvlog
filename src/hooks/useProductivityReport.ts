import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';

export interface ProductivityReportFilters {driver:string;vehicle:string;from:string;to:string}
export interface DriverProductivity {id:string;name:string;loads:number;deliveries:number;divergences:number;success_rate:number|null;avg_pallets:number}
export interface ClientDivergence {id:string;name:string;total:number;impact:number}
export interface VehicleEfficiency {id:string;plate:string;nickname:string|null;max_pallets:number;trips:number;total_pallets:number;avg_occupancy:number}
export interface ProductivityReportSummary {
  version:1;tenant_id:string;timezone:string;total_loads:number;total_events:number;total_delivered:number;total_divergent:number;
  overall_success:number|null;total_financial_impact:number;avg_pallets_per_trip:number;
  driver_metrics:DriverProductivity[];client_divergences:ClientDivergence[];vehicle_efficiency:VehicleEfficiency[];
  driver_options:Array<{id:string;name:string}>;vehicle_options:Array<{id:string;plate:string;nickname:string|null}>;
  driver_options_truncated:boolean;vehicle_options_truncated:boolean;
}

const numberValue=(value:unknown)=>Number(value)||0;

export function useProductivityReportSummary(filters:ProductivityReportFilters){
  const {currentTenant}=useTenant();
  return useQuery({
    queryKey:['productivity_report_summary',currentTenant?.id,filters],enabled:!!currentTenant,
    queryFn:async():Promise<ProductivityReportSummary>=>{
      if(!currentTenant)throw new Error('Empresa não selecionada.');
      const {data,error}=await supabase.rpc('productivity_report_summary_v1' as never,{
        _tenant_id:currentTenant.id,_driver_id:filters.driver==='all'?null:filters.driver,_vehicle_id:filters.vehicle==='all'?null:filters.vehicle,
        _from:filters.from||null,_to:filters.to||null,
      } as never);
      if(error)throw error;
      const value=data as unknown as ProductivityReportSummary;
      if(value?.version!==1||value.tenant_id!==currentTenant.id)throw new Error('Resumo de produtividade incompatível com a empresa atual.');
      return {...value,total_loads:numberValue(value.total_loads),total_events:numberValue(value.total_events),total_delivered:numberValue(value.total_delivered),
        total_divergent:numberValue(value.total_divergent),overall_success:value.overall_success===null?null:numberValue(value.overall_success),
        total_financial_impact:numberValue(value.total_financial_impact),avg_pallets_per_trip:numberValue(value.avg_pallets_per_trip),
        driver_metrics:(value.driver_metrics??[]).map(row=>({...row,loads:numberValue(row.loads),deliveries:numberValue(row.deliveries),divergences:numberValue(row.divergences),success_rate:row.success_rate===null?null:numberValue(row.success_rate),avg_pallets:numberValue(row.avg_pallets)})),
        client_divergences:(value.client_divergences??[]).map(row=>({...row,total:numberValue(row.total),impact:numberValue(row.impact)})),
        vehicle_efficiency:(value.vehicle_efficiency??[]).map(row=>({...row,max_pallets:numberValue(row.max_pallets),trips:numberValue(row.trips),total_pallets:numberValue(row.total_pallets),avg_occupancy:numberValue(row.avg_occupancy)})),
        driver_options:value.driver_options??[],vehicle_options:value.vehicle_options??[]};
    },
  });
}
