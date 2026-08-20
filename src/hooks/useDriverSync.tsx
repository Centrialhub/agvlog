import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentDriver } from './useCurrentDriver';
import { useTenant } from './useTenant';

export interface OutboxItem {
  id: string;
  tripId: string;
  stopId?: string;
  eventType: string;
  payload: any;
  idempotencyKey: string;
  createdAt: string;
  attempts: number;
}

const OUTBOX_STORAGE_KEY = 'driver_offline_outbox';

export function useDriverSync() {
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: driver } = useCurrentDriver();
  const { currentTenant } = useTenant();

  // Load outbox from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(OUTBOX_STORAGE_KEY);
    if (saved) {
      try {
        setOutbox(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse outbox', e);
      }
    }
  }, []);

  // Save outbox to localStorage
  useEffect(() => {
    localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(outbox));
  }, [outbox]);

  const addToOutbox = useCallback((item: Omit<OutboxItem, 'id' | 'createdAt' | 'attempts'>) => {
    const newItem: OutboxItem = {
      ...item,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      attempts: 0
    };
    setOutbox(prev => [...prev, newItem]);
    
    // Attempt immediate sync if online
    if (navigator.onLine) {
      syncItem(newItem);
    } else {
      toast({
        title: 'Você está offline',
        description: 'O evento foi salvo e será enviado quando houver conexão.',
      });
    }
  }, [toast]);

  const syncItem = useCallback(async (item: OutboxItem) => {
    if (!driver || !currentTenant) return false;

    try {
      const { error } = await supabase.rpc('driver_report_event_v1', {
        p_driver_id: driver.id,
        p_tenant_id: currentTenant.id,
        p_trip_id: item.tripId,
        p_stop_id: item.stopId || "",
        p_event_type: item.eventType,
        p_payload: item.payload || {},
        p_idempotency_key: item.idempotencyKey
      });

      if (error) throw error;

      // Remove from outbox on success
      setOutbox(prev => prev.filter(i => i.id !== item.id));
      queryClient.invalidateQueries({ queryKey: ['driver_workspace'] });
      return true;
    } catch (error: any) {
      console.error('Sync failed', error);
      
      // Update attempts
      setOutbox(prev => prev.map(i => 
        i.id === item.id ? { ...i, attempts: i.attempts + 1 } : i
      ));
      
      return false;
    }
  }, [driver, currentTenant, queryClient]);

  const syncAll = useCallback(async () => {
    if (isSyncing || outbox.length === 0 || !navigator.onLine) return;
    
    setIsSyncing(true);
    let successCount = 0;
    
    for (const item of outbox) {
      const success = await syncItem(item);
      if (success) successCount++;
    }
    
    if (successCount > 0) {
      toast({
        title: 'Sincronização concluída',
        description: `${successCount} evento(s) enviado(s) com sucesso.`,
      });
    }
    
    setIsSyncing(false);
  }, [outbox, isSyncing, syncItem, toast]);

  // Network listeners
  useEffect(() => {
    const handleOnline = () => syncAll();
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [syncAll]);

  // Periodic retry
  useEffect(() => {
    const interval = setInterval(syncAll, 60000); // Try every minute
    return () => clearInterval(interval);
  }, [syncAll]);

  return {
    outbox,
    addToOutbox,
    syncAll,
    isSyncing,
    isOffline: !navigator.onLine
  };
}