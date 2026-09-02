import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OperationsCenter from '@/pages/OperationsCenter';

type QueryResult = {
  data?: unknown;
  error?: Error;
  isPending: boolean;
  isError: boolean;
};

const state = vi.hoisted(() => ({
  queries: new Map<string, QueryResult>(),
  vehicles: {} as QueryResult,
  vehicleStates: {} as QueryResult,
  positions: {} as QueryResult,
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
      const result = state.queries.get(String(queryKey[0]));
      if (!result) throw new Error(`Query sem mock: ${String(queryKey[0])}`);
      return result;
    },
  };
});
vi.mock('@/hooks/useTenant', () => ({
  useTenant: () => ({ currentTenant: { id: 'tenant-1' }, loading: false }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'actor-1', email: 'operador@example.test', user_metadata: {} } }),
}));
vi.mock('@/hooks/useVehicles', () => ({ useVehicles: () => state.vehicles }));
vi.mock('@/hooks/useDrivers', () => ({ useDrivers: () => state.queries.get('ops_drivers') }));
vi.mock('@/hooks/useVehiclesState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useVehiclesState')>();
  return { ...actual, useFleetState: () => state.vehicleStates };
});
vi.mock('@/hooks/usePositions', () => ({ useFleetPositions: () => state.positions }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div aria-label="Mapa de teste">{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Popup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/maps/MapAutoFit', () => ({ MapAutoFit: () => null }));
vi.mock('@/lib/maps/leaflet', () => ({
  createTruckMarkerIcon: () => ({}),
  DEFAULT_BRAZIL_MAP_CENTER: [-15, -47],
}));
vi.mock('recharts', () => {
  const Wrapper = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const SvgWrapper = ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>;
  return {
    ResponsiveContainer: Wrapper,
    BarChart: Wrapper,
    PieChart: Wrapper,
    AreaChart: SvgWrapper,
    Pie: Wrapper,
    Bar: Wrapper,
    Area: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Cell: () => null,
    CartesianGrid: () => null,
  };
});

const ready = (data: unknown): QueryResult => ({ data, isPending: false, isError: false });
const failed = (): QueryResult => ({
  error: new Error('falha operacional QA'),
  isPending: false,
  isError: true,
});

beforeEach(() => {
  state.queries = new Map([
    ['ops_loads', ready({
      rows: [{
        id: 'load-1', load_number: '1001', status: 'in_transit', updated_at: new Date().toISOString(),
        total_weight_kg: 1000, total_pallet_count: 10, origin: 'A', destination: 'B',
        vehicles: null, drivers: null,
      }],
      activeCount: 247,
      inTransitCount: 81,
      delayedCount: 5,
    })],
    ['ops_fiscal', ready([
      { id: 'nfe-1', document_type: 'inbound', value: 100, status: 'authorized', created_at: '2026-09-01T10:00:00Z', issue_date: '2026-09-01', freight_value: null },
    ])],
    ['ops_alerts', ready({
      rows: [{ id: 'alert-1', opened_at: '2026-09-01T10:00:00Z', alert_rules: { rule_type: 'parada' }, vehicles: { plate: 'QA-1234' } }],
      total: 23,
    })],
    ['ops_incidents', ready({
      rows: [{ id: 'incident-1', status: 'open', severity: 'critical', title: 'Incidente QA', incident_type: 'route', created_at: '2026-09-01T10:00:00Z', occurred_at: null }],
      openCount: 76,
      criticalCount: 12,
    })],
    ['ops_drivers', ready([{ id: 'driver-1', active: true, name: 'Motorista QA', current_vehicle_id: null }])],
    ['ops_expenses_count', ready(11)],
    ['ops_maintenance', ready(4)],
    ['ops_trips', ready({ rows: [], total: 61 })],
  ]);
  state.vehicles = ready([]);
  state.vehicleStates = ready([]);
  state.positions = ready([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function open() {
  render(<MemoryRouter><OperationsCenter /></MemoryRouter>);
}

describe('OperationsCenter query states', () => {
  it('uses exact KPI counts while identifying sampled values and lists', () => {
    open();
    expect(screen.getByText('247')).toBeInTheDocument();
    expect(screen.getByText('81')).toBeInTheDocument();
    expect(screen.getByText('61 viagens ativas')).toBeInTheDocument();
    expect(screen.getByText(/Peso e paletes no recorte de até 200 cargas recentes/)).toBeInTheDocument();
    expect(screen.getByText('NF-es (recorte)')).toBeInTheDocument();
    expect(screen.getByText('1 no recorte')).toBeInTheDocument();
    expect(screen.getByText('Exibindo até 6 de 23 alerta(s) ativo(s).')).toBeInTheDocument();
    expect(screen.getByText('Exibindo até 5 de 76 incidente(s) aberto(s).')).toBeInTheDocument();
  });

  it('fails closed without turning read failures into zeros or empty-success messages', () => {
    for (const key of state.queries.keys()) state.queries.set(key, failed());
    state.vehicles = failed();
    state.vehicleStates = failed();
    state.positions = failed();

    open();

    expect(screen.getByText(/Alertas indisponíveis/)).toBeInTheDocument();
    expect(screen.getByText(/Incidentes indisponíveis/)).toBeInTheDocument();
    expect(screen.getByText(/Cargas indisponíveis/)).toBeInTheDocument();
    expect(screen.getByText(/Telemetria indisponível/)).toBeInTheDocument();
    expect(screen.getAllByText('indisponível').length).toBeGreaterThan(0);
    expect(screen.queryByText('Nenhum alerta ativo ✓')).not.toBeInTheDocument();
    expect(screen.queryByText('Sem incidentes abertos ✓')).not.toBeInTheDocument();
    expect(screen.queryByText(/Nenhuma carga encontrada/)).not.toBeInTheDocument();
    expect(screen.queryByText('Sem cargas')).not.toBeInTheDocument();
    expect(screen.queryByText('Sem dados de destino')).not.toBeInTheDocument();
  });
});

describe('OperationsCenter exact-count contract', () => {
  it('keeps sampled reads separate from exact count queries', () => {
    const source = readFileSync('src/pages/OperationsCenter.tsx', 'utf8');
    expect(source).toContain(".limit(200)");
    expect(source).toContain(".limit(1000)");
    expect(source).toContain(".limit(20)");
    expect(source).toMatch(/select\('id', \{ count: 'exact', head: true \}\)[\s\S]*cargas ativas/);
    expect(source).toMatch(/alert_instances'[\s\S]*count: 'exact'[\s\S]*alertas ativos/);
    expect(source).toMatch(/incidents'[\s\S]*count: 'exact'[\s\S]*incidentes abertos/);
    expect(source).toMatch(/dispatch_trips'[\s\S]*count: 'exact'[\s\S]*viagens ativas/);
  });
});
