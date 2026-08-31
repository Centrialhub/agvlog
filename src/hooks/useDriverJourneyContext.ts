import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { JOURNEY_EVENT_TYPES } from '@/lib/driverJourney';
import { useAuth } from './useAuth';
import { useTenant } from './useTenant';

const boundary = z.object({ id: z.string(), event_at: z.string(), dispatch_trip_id: z.string() });
const contextSchema = z.object({
  events: z.array(boundary.extend({ event_type: z.enum(JOURNEY_EVENT_TYPES), created_at: z.string() })),
  last_start: boundary.nullable(),
  last_end: boundary.nullable(),
});

export function useDriverJourneyContext() {
  const { user } = useAuth();
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['driver_journey_events', currentTenant?.id, user?.id],
    enabled: !!user?.id && !!currentTenant?.id,
    queryFn: async () => {
      if (!currentTenant || !user) throw new Error('Sessão do motorista indisponível');
      const { data, error } = await supabase.rpc('driver_get_journey_context', { _tenant_id: currentTenant.id });
      if (error) throw error;
      return contextSchema.parse(data);
    },
  });
}
