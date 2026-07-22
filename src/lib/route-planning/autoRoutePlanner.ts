import { consolidateLoadsIntoStops, type ConsolidationLoad } from './stopConsolidation';
import { groupLoadsForRouting, type OperationalRouteLite } from './loadGrouping';
import { autoSequenceStops } from './simpleStopSequencing';
import { simulateStopTimeline } from './timelineSimulation';
import { suggestBestVehicleForRoute, type VehicleLite } from './vehicleSuggestion';
import { suggestBestDriverForRoute, type DriverLite } from './driverSuggestion';
import type { RouteStopDraft, CustomerWindow } from './routePlanningTypes';

export interface AutoRoutePlannerInput {
  loads: ConsolidationLoad[];
  vehicles: VehicleLite[];
  drivers: DriverLite[];
  operationalRoutes?: OperationalRouteLite[];
  customerWindows?: CustomerWindow[];
  plannedStartAt: string;
  tenantConfig?: {
    defaultServiceTimeMinutes?: number;
    defaultWorkingWindowStart?: string;
    defaultWorkingWindowEnd?: string;
    maxStopsPerRoute?: number;
    /** Minutos do depósito/origem até a 1ª parada (default 30). */
    initialTransitMinutes?: number;
  };
}

export interface GeneratedRoutePlan {
  id: string;
  name: string;
  loads: ConsolidationLoad[];
  stops: RouteStopDraft[];
  vehicle_id?: string;
  driver_id?: string;
  planned_start_at: string;
  sortMode: 'auto';
  automation_score: number;
  automation_warnings: string[];
  requires_review: boolean;
}

function applyCustomerWindows(stops: RouteStopDraft[], windows: CustomerWindow[], defaults?: { start?: string; end?: string }): RouteStopDraft[] {
  if (!windows.length && !defaults) return stops;
  const byClient = new Map<string, CustomerWindow>();
  windows.forEach(w => { if (!byClient.has(w.client_id)) byClient.set(w.client_id, w); });
  return stops.map(s => {
    if (s.delivery_window_start || s.delivery_window_end) return s;
    if (s.client_id && byClient.has(s.client_id)) {
      const w = byClient.get(s.client_id)!;
      return { ...s, delivery_window_start: w.start_time, delivery_window_end: w.end_time };
    }
    if (defaults?.start && defaults?.end) {
      return { ...s, delivery_window_start: defaults.start, delivery_window_end: defaults.end };
    }
    return s;
  });
}

export function generateAutomaticRoutePlans(input: AutoRoutePlannerInput): GeneratedRoutePlan[] {
  const {
    loads, vehicles, drivers, operationalRoutes = [], customerWindows = [],
    plannedStartAt, tenantConfig = {},
  } = input;

  const groups = groupLoadsForRouting(loads, operationalRoutes, tenantConfig.maxStopsPerRoute || 30);
  const usedVehicleIds = new Set<string>();
  const usedDriverIds = new Set<string>();

  return groups.map((g) => {
    const warnings: string[] = [];
    if (g.requires_review && g.review_reason) warnings.push(g.review_reason);

    // 1) Paradas
    let stops = consolidateLoadsIntoStops(g.loads);

    // 2) Janelas (cliente cadastrado ou fallback opcional)
    stops = applyCustomerWindows(stops, customerWindows, {
      start: tenantConfig.defaultWorkingWindowStart,
      end: tenantConfig.defaultWorkingWindowEnd,
    });

    // 3) Ajustar tempo de serviço default
    if (tenantConfig.defaultServiceTimeMinutes) {
      stops = stops.map(s => ({ ...s, service_time_minutes: s.service_time_minutes || tenantConfig.defaultServiceTimeMinutes! }));
    }

    const initialTransitMinutes = tenantConfig.initialTransitMinutes ?? 30;
    // 4) Simulação inicial (para classificação de risco)
    stops = simulateStopTimeline(stops, plannedStartAt, { initialTransitMinutes });

    // 5) Sequência automática
    stops = autoSequenceStops(stops);

    // 6) Re-simular já na ordem definitiva
    stops = simulateStopTimeline(stops, plannedStartAt, { initialTransitMinutes });

    // 7) Necessidade x veículo
    const need = {
      pallets: stops.reduce((s, x) => s + x.total_pallet_count, 0),
      weight_kg: stops.reduce((s, x) => s + x.total_weight_kg, 0),
      volume_m3: stops.reduce((s, x) => s + x.total_volume_m3, 0),
    };
    // 7a) Herda veículo/motorista pré-atribuídos em /loads quando todo o grupo concorda
    const preassignedVehicles = new Set(g.loads.map(l => l.vehicle_id || undefined).filter(Boolean) as string[]);
    const preassignedDrivers = new Set(g.loads.map(l => l.driver_id || undefined).filter(Boolean) as string[]);
    const inheritedVehicleId = preassignedVehicles.size === 1 ? Array.from(preassignedVehicles)[0] : null;
    const inheritedDriverId = preassignedDrivers.size === 1 ? Array.from(preassignedDrivers)[0] : null;

    let vehicleId: string | undefined;
    let driverId: string | undefined;

    if (inheritedVehicleId) {
      vehicleId = inheritedVehicleId;
      usedVehicleIds.add(inheritedVehicleId);
    } else {
      const vSug = suggestBestVehicleForRoute(need, vehicles, usedVehicleIds);
      if (vSug.vehicle) { vehicleId = vSug.vehicle.id; usedVehicleIds.add(vSug.vehicle.id); }
      else if (vSug.reason) warnings.push(vSug.reason);
    }

    if (inheritedDriverId) {
      driverId = inheritedDriverId;
      usedDriverIds.add(inheritedDriverId);
    } else {
      const dSug = suggestBestDriverForRoute(vehicleId, drivers, usedDriverIds);
      if (dSug.driver) { driverId = dSug.driver.id; usedDriverIds.add(dSug.driver.id); }
      else if (dSug.reason) warnings.push(dSug.reason);
    }

    const criticalStops = stops.filter(s => s.risk_level === 'critical').length;
    const warningStops = stops.filter(s => s.risk_level === 'warning').length;
    if (criticalStops > 0) warnings.push(`${criticalStops} parada(s) com risco crítico.`);
    if (warningStops > 0) warnings.push(`${warningStops} parada(s) com alerta.`);

    // Score: 100 base, -20 por crítico, -5 por warning, -30 se sem veículo, -30 se sem motorista
    let score = 100;
    if (!vehicleId) score -= 30;
    if (!driverId) score -= 30;
    score -= criticalStops * 20;
    score -= warningStops * 5;
    score = Math.max(0, Math.min(100, score));

    const requires_review = g.requires_review || !vehicleId || !driverId || criticalStops > 0;

    return {
      id: crypto.randomUUID(),
      name: g.name,
      loads: g.loads,
      stops,
      vehicle_id: vehicleId,
      driver_id: driverId,
      planned_start_at: plannedStartAt,
      sortMode: 'auto' as const,
      automation_score: score,
      automation_warnings: warnings,
      requires_review,
    };
  });
}

/** Próximo horário operacional padrão: hoje 08:00, ou próxima hora cheia se já passou. */
export function defaultPlannedStartAt(): string {
  const now = new Date();
  const target = new Date(now);
  target.setHours(8, 0, 0, 0);
  if (now.getTime() > target.getTime()) {
    target.setTime(now.getTime() + 60 * 60_000);
    target.setMinutes(0, 0, 0);
  }
  // Formato datetime-local: YYYY-MM-DDTHH:MM
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(target.getHours())}:${pad(target.getMinutes())}`;
}