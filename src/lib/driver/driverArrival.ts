import { supabase } from '@/integrations/supabase/client';
import { getCurrentDriverLocation } from '@/lib/driverLocation';

export async function markDriverArrival(stopId: string) {
  const location = await getCurrentDriverLocation();
  const { data, error } = await supabase.rpc('driver_mark_arrival', {
    _stop_id: stopId,
    _latitude: location.latitude,
    _longitude: location.longitude,
    _accuracy_m: location.accuracyM,
  });
  if (error) throw error;
  return data;
}
