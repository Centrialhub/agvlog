import {useQuery} from '@tanstack/react-query';
import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/hooks/useAuth';

const journeySchema=z.object({
  version:z.literal(1),
  has_active_journey:z.boolean(),
  journey:z.object({id:z.string(),workspace_id:z.string(),status:z.string()}).passthrough().optional(),
  driver:z.object({id:z.string(),tenant_id:z.string(),name:z.string(),active:z.boolean()}).nullable().optional(),
  trips:z.array(z.object({
    id:z.string(),trip_id:z.string(),tenant_id:z.string(),trip_order:z.number(),status:z.string(),
    driver_id:z.string().nullable(),vehicle_id:z.string().nullable(),load_id:z.string().nullable(),
    actual_start_at:z.string().nullable(),
    loads:z.object({id:z.string(),load_number:z.string(),origin:z.string().nullable(),destination:z.string().nullable(),status:z.string()}).nullable(),
    vehicles:z.object({plate:z.string(),nickname:z.string().nullable()}).nullable(),
  }).passthrough()).optional().default([]),
  stops:z.array(z.object({
    id:z.string(),stop_id:z.string(),tenant_id:z.string(),journey_order:z.number(),dispatch_trip_id:z.string(),
    stop_order:z.number(),destination:z.string().nullable(),status:z.string(),latitude:z.union([z.string(),z.number()]).nullable(),
    longitude:z.union([z.string(),z.number()]).nullable(),notes:z.string().nullable(),
    clients:z.object({company_name:z.string()}).nullable(),
  }).passthrough()).optional().default([]),
});

export type DriverPhysicalJourney=z.infer<typeof journeySchema>;

export function useDriverPhysicalJourney(){
  const {user}=useAuth();
  return useQuery({
    queryKey:['driver_physical_journey',user?.id],
    queryFn:async()=>{
      const {data,error}=await supabase.rpc('get_current_driver_journey_v1');
      if(error)throw error;
      return journeySchema.parse(data);
    },
    enabled:!!user,
    retry:1,
    staleTime:30_000,
    refetchInterval:30_000,
  });
}
