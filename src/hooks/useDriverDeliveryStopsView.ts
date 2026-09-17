import { useMemo, useState } from 'react';
import { isStopTerminal } from '@/lib/status/stopStatus';
import { getStopOrderNumber, type DriverStop } from '@/components/driver/deliveries/driverDeliveryEvents';
import type { DeliveryStopTab } from '@/components/driver/deliveries/DriverDeliveryStopList';

export function useDriverDeliveryStopsView(stops: DriverStop[], pendingStopIds: Set<string>) {
  const [tab, setTab] = useState<DeliveryStopTab>('em_rota');
  const [search, setSearch] = useState('');

  const { enRouteStops, completedStops } = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matchesSearch = (stop: DriverStop) => {
      if (!query) return true;
      const name = (stop.clients?.company_name || stop.destination || '').toLowerCase();
      const order = (getStopOrderNumber(stop) || '').toLowerCase();
      const notes = (stop.notes || '').toLowerCase();
      return name.includes(query) || order.includes(query) || notes.includes(query);
    };
    const completed = (stop: DriverStop) => pendingStopIds.has(stop.id)
      || isStopTerminal(stop.status)
      || stop.status === 'completed'
      || stop.status === 'delivered';
    return {
      enRouteStops: stops.filter((stop) => !completed(stop) && matchesSearch(stop)),
      completedStops: stops.filter((stop) => completed(stop) && matchesSearch(stop)),
    };
  }, [pendingStopIds, search, stops]);
  const filteredStops = tab === 'em_rota' ? enRouteStops : completedStops;

  return { tab, setTab, search, setSearch, filteredStops, completedStops, enRouteCount: enRouteStops.length };
}
