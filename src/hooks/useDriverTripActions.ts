import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useRef } from 'react';

import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { driverTripNeedsReconciliation, isDriverTripStarted } from '@/lib/driverTrip';
import { invalidateTripLoadQueries, isConfirmedTripStart, tripMutationError } from '@/lib/tripMutation';

export function useDriverTripActions() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const startingRef=useRef(false);

  const startTrip = useMutation({
    retry:false,
    mutationFn: async (tripId: string) => {
      const { data,error } = await supabase.rpc('driver_start_trip', { _trip_id: tripId });
      if (error) throw error;
      if(!isConfirmedTripStart(data,tripId))throw new Error('Não foi possível confirmar o início. Atualize os dados antes de tentar novamente.');
      return tripId;
    },
    onSuccess: async (tripId) => {
      await invalidateTripLoadQueries(queryClient);
      navigate(`/driver/stops?trip=${tripId}`);
    },
    onError: async (error: unknown) => {
      await invalidateTripLoadQueries(queryClient);
      toast({
        title: 'Não foi possível iniciar a viagem',
        description:tripMutationError(error).message,
        variant: 'destructive',
      });
    },
    onSettled:()=>{startingRef.current=false;},
  });

  const accessTrip = (
    tripId: string,
    currentStatus?: string | null,
    actualStartAt?: string | null,
    loadStatus?: string | null,
  ) => {
    if(startingRef.current)return;
    if (driverTripNeedsReconciliation(currentStatus, actualStartAt, loadStatus)) {
      toast({ title: 'Revisão operacional necessária',
        description: 'Carga e viagem têm registros divergentes. Confirme o início histórico com a operação.',
        variant: 'destructive' });
      return;
    }
    if (isDriverTripStarted(currentStatus, actualStartAt)) {
      navigate(`/driver/stops?trip=${tripId}`);
      return;
    }
    startingRef.current=true;
    startTrip.mutate(tripId);
  };

  return { accessTrip, isStartingTrip: startTrip.isPending };
}
