import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export function useDriverTripActions() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const startTrip = useMutation({
    mutationFn: async (tripId: string) => {
      const { error } = await supabase.rpc('driver_start_trip', { _trip_id: tripId });
      if (error) throw error;
      return tripId;
    },
    onSuccess: async (tripId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['driver_active_trip'] }),
        queryClient.invalidateQueries({ queryKey: ['driver_my_trips'] }),
        queryClient.invalidateQueries({ queryKey: ['driver_my_loads'] }),
        queryClient.invalidateQueries({ queryKey: ['driver_all_assigned_loads'] }),
      ]);
      navigate(`/driver/stops?trip=${tripId}`);
    },
    onError: (error: unknown) => {
      const description = error instanceof Error
        ? error.message
        : 'Confirme a atribuição do motorista e tente novamente.';
      toast({
        title: 'Não foi possível iniciar a viagem',
        description,
        variant: 'destructive',
      });
    },
  });

  const accessTrip = (tripId: string, currentStatus?: string | null) => {
    if (currentStatus === 'in_transit') {
      navigate(`/driver/stops?trip=${tripId}`);
      return;
    }
    startTrip.mutate(tripId);
  };

  return { accessTrip, isStartingTrip: startTrip.isPending };
}
