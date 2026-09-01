import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import type { Tables } from '@/integrations/supabase/types';

const POSITION_LAST_SAFE_SELECT =
  'tenant_id, vehicle_id, lat, lng, speed, heading, captured_at, received_at';
const POSITION_PAGE_SIZE = 500;
const MAX_FLEET_POSITIONS = 5_000;
const MAX_HISTORY_POINTS = 5_000;

export type PositionLast = Pick<
  Tables<'positions_last'>,
  'tenant_id' | 'vehicle_id' | 'lat' | 'lng' | 'speed' | 'heading' | 'captured_at' | 'received_at'
>;
export type PositionRaw = Pick<
  Tables<'positions_raw'>,
  'id' | 'tenant_id' | 'vehicle_id' | 'lat' | 'lng' | 'speed' | 'heading' | 'captured_at' | 'received_at'
>;

export async function fetchFleetPositionPages(tenantId: string, signal: AbortSignal): Promise<PositionLast[]> {
  const rows: PositionLast[] = [];
  let afterVehicleId: string | null = null;

  for (let pageIndex = 0; pageIndex <= MAX_FLEET_POSITIONS / POSITION_PAGE_SIZE; pageIndex += 1) {
    const isOverflowProbe = pageIndex === MAX_FLEET_POSITIONS / POSITION_PAGE_SIZE;
    const pageSize = isOverflowProbe ? 1 : POSITION_PAGE_SIZE;
    let query = supabase
      .from('positions_last')
      .select(POSITION_LAST_SAFE_SELECT)
      .eq('tenant_id', tenantId)
      .order('vehicle_id', { ascending: true })
      .limit(pageSize);
    if (afterVehicleId) query = query.gt('vehicle_id', afterVehicleId);
    const { data, error } = await query
      .abortSignal(signal);

    if (error) throw error;
    const page = (data || []) as PositionLast[];
    if (isOverflowProbe) {
      if (page.length > 0) {
        throw new Error('A frota excede o limite seguro de 5.000 posições. Refine a consulta.');
      }
      return rows;
    }

    rows.push(...page);
    if (page.length < pageSize) return rows;
    const lastVehicleId = page.at(-1)?.vehicle_id;
    if (!lastVehicleId || lastVehicleId === afterVehicleId) {
      throw new Error('O cursor de posições da frota não avançou.');
    }
    afterVehicleId = lastVehicleId;
  }

  return rows;
}

export function useFleetPositions(enabled = true) {
  const { currentTenant } = useTenant();

  return useQuery({
    queryKey: ['positions_last', currentTenant?.id],
    queryFn: ({ signal }) => {
      if (!currentTenant) return [];
      return fetchFleetPositionPages(currentTenant.id, signal);
    },
    enabled: !!currentTenant && enabled,
    refetchInterval: 30000, // 30s auto-refresh
    refetchIntervalInBackground: false,
  });
}

export function useVehicleHistory(vehicleId: string | null, startDate?: string, endDate?: string) {
  const { currentTenant } = useTenant();

  return useQuery({
    queryKey: ['positions_raw', currentTenant?.id, vehicleId, startDate, endDate],
    queryFn: async ({ signal }) => {
      if (!currentTenant || !vehicleId || !startDate || !endDate) return [];

      const rows: PositionRaw[] = [];
      let afterCapturedAt: string | null = null;
      let afterId: string | null = null;

      for (let pageIndex = 0; pageIndex <= MAX_HISTORY_POINTS / POSITION_PAGE_SIZE; pageIndex += 1) {
        const isOverflowProbe = pageIndex === MAX_HISTORY_POINTS / POSITION_PAGE_SIZE;
        const pageSize = isOverflowProbe ? 1 : POSITION_PAGE_SIZE;
        const { data, error } = await supabase
          .rpc('list_vehicle_position_history_v1' as never, {
            _tenant_id: currentTenant.id,
            _vehicle_id: vehicleId,
            _start_at: startDate,
            _end_at: endDate,
            _after_captured_at: afterCapturedAt,
            _after_id: afterId,
            _page_size: pageSize,
          } as never)
          .abortSignal(signal);

        if (error) throw error;
        const page = (data || []) as unknown as PositionRaw[];
        if (isOverflowProbe) {
          if (page.length > 0) {
            throw new Error('O histórico excede 5.000 pontos. Reduza o período consultado.');
          }
          return rows;
        }

        rows.push(...page);
        if (page.length < pageSize) return rows;

        const last = page.at(-1);
        if (!last || (last.captured_at === afterCapturedAt && last.id === afterId)) {
          throw new Error('O cursor do histórico de posições não avançou.');
        }
        afterCapturedAt = last.captured_at;
        afterId = last.id;
      }

      return rows;
    },
    enabled: !!currentTenant && !!vehicleId && !!startDate && !!endDate,
    retry: false,
  });
}

export function useVehiclePosition(vehicleId: string | null) {
  const { currentTenant } = useTenant();

  return useQuery({
    queryKey: ['position_last', currentTenant?.id, vehicleId],
    queryFn: async ({ signal }) => {
      if (!currentTenant || !vehicleId) return null;
      const { data, error } = await supabase
        .from('positions_last')
        .select(POSITION_LAST_SAFE_SELECT)
        .eq('tenant_id', currentTenant.id)
        .eq('vehicle_id', vehicleId)
        .abortSignal(signal)
        .maybeSingle();
      if (error) throw error;
      return data as PositionLast | null;
    },
    enabled: !!currentTenant && !!vehicleId,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
