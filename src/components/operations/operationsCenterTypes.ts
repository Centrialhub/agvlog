import type { MovementState } from '@/hooks/useVehiclesState';
import type { Vehicle } from '@/hooks/useVehicles';

export interface OperationsCenterLoad {
  id: string;
  load_number: string;
  status: string;
  updated_at: string;
  total_weight_kg: number | null;
  total_pallet_count: number | null;
  origin: string | null;
  destination: string | null;
  vehicles: { plate: string; nickname: string | null } | null;
  drivers: { name: string } | null;
}

export interface OperationsCenterAlert {
  id: string;
  opened_at: string;
  alert_rules: { rule_type: string; params: unknown } | null;
  vehicles: { plate: string; nickname: string | null } | null;
}

export interface OperationsCenterIncident {
  id: string;
  severity: string;
  title: string;
  incident_type: string;
}

export interface OperationsCenterVehiclePosition {
  vehicle: Vehicle;
  state: MovementState;
  lat: number | null;
  lng: number | null;
  speed: number | null;
  stoppedDuration: number;
  lastPositionAt: string | null;
}

export interface OperationsCenterStats {
  activeLoads: number;
  inTransit: number;
  delayed: number;
  totalWeightActive: number;
  totalPalletsActive: number;
  nfeCount: number;
  cteCount: number;
  totalNfeValue: number;
  totalCteValue: number;
  totalFreight: number;
  activeDrivers: number;
  driversWithVehicle: number;
  openIncidents: number;
  criticalIncidents: number;
  activeTrips: number;
}

export interface OperationsCenterFleetStats {
  total: number;
  moving: number;
  stopped: number;
  idle: number;
  offline: number;
  unknown: number;
  online: number;
}

export interface OperationsCenterViewModel {
  loads: OperationsCenterLoad[];
  alerts: OperationsCenterAlert[];
  incidents: OperationsCenterIncident[];
  vehiclesWithPosition: OperationsCenterVehiclePosition[];
  mapPoints: [number, number][];
  fleetStats: OperationsCenterFleetStats;
  stats: OperationsCenterStats;
  destChart: Array<{ dest: string; pallets: number; weight: number; count: number }>;
  statusChart: Array<{ name: string; value: number }>;
  nfeByDay: Array<{ day: string; qty: number }>;
  pendingExpenses: number | null;
  openMaintenance: number | null;
  alertTotal: number;
  loadsPending: boolean;
  loadsUnavailable: boolean;
  fiscalPending: boolean;
  fiscalUnavailable: boolean;
  alertsPending: boolean;
  alertsUnavailable: boolean;
  incidentsPending: boolean;
  incidentsUnavailable: boolean;
  driversPending: boolean;
  driversUnavailable: boolean;
  expensesPending: boolean;
  expensesUnavailable: boolean;
  maintenancePending: boolean;
  maintenanceUnavailable: boolean;
  tripsPending: boolean;
  tripsUnavailable: boolean;
  fleetPending: boolean;
  fleetUnavailable: boolean;
  hasDelayedLoads: boolean;
  hasOpenIncidents: boolean;
}
