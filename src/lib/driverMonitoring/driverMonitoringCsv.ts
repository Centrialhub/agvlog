import type { DriverMonitorRow, ProgressUpdateRow, ForecastRow } from '@/hooks/useDriverMonitoring';
import { STATUS_LABELS } from './driverMonitoringCalculator';

const dt = (v?: string | null) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '');
const tm = (v?: string | null) => (v ? v.slice(0, 5) : '');
const esc = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCsv = (rows: (string | number | null)[][]) =>
  '\uFEFF' + rows.map((r) => r.map(esc).join(';')).join('\n');

export function driversInRouteCsv(rows: DriverMonitorRow[]): string {
  const header = ['Motorista', 'Placa', 'Carga', 'Rota planejada', 'Total', 'Realizadas', 'Faltantes', 'Progresso %', 'Cidade atual', 'Próxima cidade', 'Prazo retorno', 'Previsão chegada', 'Status', 'Observação'];
  const body = rows.map((r) => [
    r.driver_name_snapshot || '', r.vehicle_plate_snapshot || '', r.load_number || '',
    r.planned_route_text || '',
    r.total_deliveries, r.completed_deliveries, r.remaining_deliveries,
    r.progress_percent, r.current_city || '', r.next_city || '',
    dt(r.expected_return_date), r.arrival_forecast_text || '',
    STATUS_LABELS[r.status as keyof typeof STATUS_LABELS] || r.status, r.notes || '',
  ]);
  return toCsv([header, ...body]);
}

export function deliveriesByDriverCsv(rows: ProgressUpdateRow[]): string {
  const header = ['Data', 'Motorista', 'Cidade', 'Entregas realizadas', 'Próxima cidade', 'Entregas próxima', 'Horário término', 'Status', 'Observação'];
  const body = rows.map((r) => [
    dt(r.update_date), r.driver_name || '', r.city || '',
    r.deliveries_completed_in_city, r.next_city || '', r.next_city_deliveries ?? '',
    tm(r.city_finished_at), r.status || '', r.observation || '',
  ]);
  return toCsv([header, ...body]);
}

export function arrivalForecastsCsv(rows: ForecastRow[]): string {
  const header = ['Data', 'Hora', 'Motorista', 'Cidade atual', 'Previsão Montes Claros', 'Cidades restantes', 'Status', 'Observação'];
  const body = rows.map((r) => [
    dt(r.forecast_date), tm(r.forecast_time), r.driver_name || '',
    r.current_city || '', r.forecast_text || '', r.remaining_cities_text || '',
    STATUS_LABELS[r.status as keyof typeof STATUS_LABELS] || r.status, r.observation || '',
  ]);
  return toCsv([header, ...body]);
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}