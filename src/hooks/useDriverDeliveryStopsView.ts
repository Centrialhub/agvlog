import { useMemo, useState } from 'react';
import { isStopTerminal } from '@/lib/status/stopStatus';
import { getStopOrderNumber, type DriverStop } from '@/components/driver/deliveries/driverDeliveryEvents';
import type { DeliveryStopTab } from '@/components/driver/deliveries/DriverDeliveryStopList';

export function useDriverDeliveryStopsView(stops: DriverStop[], pendingStopIds: Set<string>) {
  const [tab, setTab] = useState<DeliveryStopTab>('em_rota');
  const [search, setSearch] = useState('');

  const filteredStops = useMemo(() => {
    const query = search.trim().toLowerCase();
    const visible = tab === 'em_rota'
      ? stops.filter((stop) => !pendingStopIds.has(stop.id) && !isStopTerminal(stop.status) && stop.status !== 'completed')
      : stops.filter((stop) => pendingStopIds.has(stop.id) || isStopTerminal(stop.status) || stop.status === 'completed');
    if (!query) return visible;
    return visible.filter((stop) => {
      const name = (stop.clients?.company_name || stop.destination || '').toLowerCase();
      const order = (getStopOrderNumber(stop) || '').toLowerCase();
      const notes = (stop.notes || '').toLowerCase();
      return name.includes(query) || order.includes(query) || notes.includes(query);
    });
  }, [pendingStopIds, search, stops, tab]);

  const completedStops = useMemo(() => stops.filter(
    (stop) => pendingStopIds.has(stop.id) || isStopTerminal(stop.status) || stop.status === 'completed' || stop.status === 'delivered',
  ), [pendingStopIds, stops]);

  return { tab, setTab, search, setSearch, filteredStops, completedStops };
}
