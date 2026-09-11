import { useNavigate } from 'react-router-dom';
import { useRef, useState } from 'react';

import { useToast } from '@/hooks/use-toast';
import { driverTripNeedsReconciliation, isDriverTripStarted } from '@/lib/driverTrip';
import { useTenant } from '@/hooks/useTenant';

export function useDriverTripActions() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { currentTenant, activateTenantId } = useTenant();
  const startingRef=useRef(false);
  const [isOpeningTrip,setIsOpeningTrip]=useState(false);

  const accessTrip = (
    tripId: string,
    currentStatus?: string | null,
    actualStartAt?: string | null,
    loadStatus?: string | null,
    tenantId?: string,
  ) => {
    if(startingRef.current)return;
    if (driverTripNeedsReconciliation(currentStatus, actualStartAt, loadStatus)) {
      toast({ title: 'Revisão operacional necessária',
        description: 'Carga e viagem têm registros divergentes. Confirme o início histórico com a operação.',
        variant: 'destructive' });
      return;
    }
    startingRef.current=true;
    setIsOpeningTrip(true);
    void (async()=>{
      try {
        if(tenantId&&tenantId!==currentTenant?.id){
          const activated=await activateTenantId(tenantId);
          if(!activated){
            toast({title:'Não foi possível abrir a viagem',description:'A empresa responsável pela viagem não pôde ser ativada.',variant:'destructive'});
            return;
          }
        }
        navigate(isDriverTripStarted(currentStatus, actualStartAt)
          ? `/driver/stops?trip=${tripId}`
          : `/driver/cargo?trip=${encodeURIComponent(tripId)}`);
      } finally {
        startingRef.current=false;
        setIsOpeningTrip(false);
      }
    })();
  };

  return { accessTrip, isStartingTrip: isOpeningTrip };
}
