import * as XLSX from 'xlsx';
import { excelSerialToIso, toNumber } from '@/lib/loadImports/loadImportNormalizer';
import { normalizePlannedRoute, normalizeStatusLabel, parseRemainingCities } from './driverMonitoringCalculator';

export interface ParsedProgressUpdate {
  update_date: string | null;
  city: string | null;
  deliveries_completed_in_city: number;
  city_total_deliveries: number | null;
  deadline_to_finish: string | null;
  city_finished_at: string | null;
  next_city: string | null;
  next_city_deliveries: number | null;
  next_deadline_to_finish: string | null;
  next_city_finished_at: string | null;
  observation: string | null;
  status: string | null;
}

export interface ParsedMonitor {
  driver_name: string;
  total_deliveries: number;
  return_deadline_days: number | null;
  planned_route_text: string | null;
  planned_cities: string[];
  updates: ParsedProgressUpdate[];
  legacy_status_notes: string[];
}

export interface ParsedForecast {
  forecast_date: string | null;
  forecast_time: string | null;
  weekday: string | null;
  driver_name: string | null;
  current_city: string | null;
  forecast_text: string | null;
  remaining_cities_text: string | null;
  remaining_cities: string[];
  observation: string | null;
}

export interface ParsedDriverMonitoringWorkbook {
  monitors: ParsedMonitor[];
  forecasts: ParsedForecast[];
  errors: string[];
  sheetNames: string[];
}

function excelSerialToTime(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && isFinite(v)) {
    const frac = v - Math.floor(v);
    const totalSec = Math.round(frac * 86400);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  return s || null;
}

function normHeader(v: unknown): string {
  return String(v ?? '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function cellStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function parseInteger(v: unknown): number {
  const n = toNumber(v);
  return Math.floor(n);
}

function findSheet(wb: XLSX.WorkBook, ...targets: string[]): XLSX.WorkSheet | null {
  for (const name of wb.SheetNames) {
    const n = normHeader(name);
    if (targets.some((t) => n.includes(normHeader(t)))) return wb.Sheets[name];
  }
  return null;
}

/**
 * Parse the "Entregas" sheet: blocks per driver separated by header rows.
 * A driver block starts when a row's "Rastreio" column contains a driver name
 * (non-empty, not equal to header "Rastreio").
 */
function parseEntregasSheet(ws: XLSX.WorkSheet, errors: string[]): ParsedMonitor[] {
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  if (!rows.length) return [];

  const monitors: ParsedMonitor[] = [];
  let current: ParsedMonitor | null = null;
  let headerIdx: Record<string, number> = {};

  const applyHeader = (row: any[]) => {
    headerIdx = {};
    row.forEach((c, i) => {
      const h = normHeader(c);
      if (!h) return;
      if (h.includes('rastreio')) headerIdx.driver = i;
      else if (h.includes('numero') && h.includes('entrega')) headerIdx.total = i;
      else if (h.includes('prazo') && h.includes('retorno')) headerIdx.deadline_days = i;
      else if (h === 'data' || h.startsWith('data')) headerIdx.date = headerIdx.date ?? i;
      else if (h.includes('localidade') && !h.includes('proxima')) headerIdx.city = i;
      else if (h.includes('qtd') && h.includes('cidade') && !headerIdx.qty1) headerIdx.qty1 = i;
      else if (h.includes('prazo') && h.includes('terminar') && !headerIdx.pt1) headerIdx.pt1 = i;
      else if (h.includes('horario') && h.includes('termino') && !headerIdx.ht1) headerIdx.ht1 = i;
      else if (h.includes('proxima') && (h.includes('local') || h.includes('cidade'))) headerIdx.next = i;
      else if (h.includes('qtd') && (h.includes('2') || h.includes('proxima'))) headerIdx.qty2 = i;
      else if (h.includes('prazo') && (h.includes('2') || h.includes('proxima'))) headerIdx.pt2 = i;
      else if (h.includes('horario') && (h.includes('2') || h.includes('proxima'))) headerIdx.ht2 = i;
      else if (h.includes('observ')) headerIdx.obs = i;
      else if (h === 'status' || h.includes('status')) headerIdx.status = i;
    });
  };

  for (const row of rows) {
    if (!row || row.every((c) => c == null || String(c).trim() === '')) continue;
    const firstCell = cellStr(row[0]) || '';
    const firstNorm = normHeader(firstCell);

    // Header row detection
    if (firstNorm === 'rastreio') {
      applyHeader(row);
      continue;
    }

    // "Rota planejada:" line
    if (/^rota\s+planejada/i.test(firstCell)) {
      if (current) {
        const joined = row.map((c) => cellStr(c)).filter(Boolean).join(' ');
        const { text, cities } = normalizePlannedRoute(joined);
        current.planned_route_text = text;
        current.planned_cities = cities;
      }
      continue;
    }

    // "Falta realizar" / "Entregas realizadas -Dia" summary lines: skip (we recalc)
    if (/^falta\s+realizar/i.test(firstCell) || /^entregas?\s+realizada/i.test(firstCell)) {
      continue;
    }

    // Driver block starts: first column has a name-like value AND (a total column exists)
    const totalCandidate = headerIdx.total != null ? parseInteger(row[headerIdx.total]) : 0;
    const deadlineCandidate = headerIdx.deadline_days != null ? parseInteger(row[headerIdx.deadline_days]) : 0;
    if (firstCell && !firstNorm.match(/^\d/) && (totalCandidate > 0 || deadlineCandidate > 0)) {
      if (current) monitors.push(current);
      current = {
        driver_name: firstCell,
        total_deliveries: totalCandidate,
        return_deadline_days: deadlineCandidate || null,
        planned_route_text: null,
        planned_cities: [],
        updates: [],
        legacy_status_notes: [],
      };
      // The same row may already contain the first daily update
    }

    if (!current) continue;

    // Attempt to read a progress update row
    const dateVal = headerIdx.date != null ? excelSerialToIso(row[headerIdx.date]) : null;
    const city = headerIdx.city != null ? cellStr(row[headerIdx.city]) : null;
    const qty1 = headerIdx.qty1 != null ? parseInteger(row[headerIdx.qty1]) : 0;
    const nextCity = headerIdx.next != null ? cellStr(row[headerIdx.next]) : null;

    if (dateVal || city || qty1 || nextCity) {
      const upd: ParsedProgressUpdate = {
        update_date: dateVal,
        city,
        deliveries_completed_in_city: qty1,
        city_total_deliveries: null,
        deadline_to_finish: headerIdx.pt1 != null ? cellStr(row[headerIdx.pt1]) : null,
        city_finished_at: headerIdx.ht1 != null ? excelSerialToTime(row[headerIdx.ht1]) : null,
        next_city: nextCity,
        next_city_deliveries: headerIdx.qty2 != null ? parseInteger(row[headerIdx.qty2]) || null : null,
        next_deadline_to_finish: headerIdx.pt2 != null ? cellStr(row[headerIdx.pt2]) : null,
        next_city_finished_at: headerIdx.ht2 != null ? excelSerialToTime(row[headerIdx.ht2]) : null,
        observation: headerIdx.obs != null ? cellStr(row[headerIdx.obs]) : null,
        status: headerIdx.status != null ? cellStr(row[headerIdx.status]) : null,
      };
      if (!dateVal && headerIdx.date != null && row[headerIdx.date] != null && row[headerIdx.date] !== '') {
        errors.push(`Data inválida na aba Entregas: ${row[headerIdx.date]}`);
      }
      current.updates.push(upd);
      if (upd.status) current.legacy_status_notes.push(upd.status);
    }
  }
  if (current) monitors.push(current);
  return monitors;
}

function parseChegadaSheet(ws: XLSX.WorkSheet, errors: string[]): ParsedForecast[] {
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  if (!rows.length) return [];
  let idx: Record<string, number> = {};
  const forecasts: ParsedForecast[] = [];

  for (const row of rows) {
    if (!row || row.every((c) => c == null || String(c).trim() === '')) continue;
    const firstNorm = normHeader(row[0]);
    if (firstNorm === 'data' || firstNorm === 'dia' || firstNorm.startsWith('data')) {
      idx = {};
      row.forEach((c, i) => {
        const h = normHeader(c);
        if (h === 'data') idx.date = i;
        else if (h.includes('dia') && h.includes('semana')) idx.weekday = i;
        else if (h === 'hora' || h.includes('horario')) idx.time = i;
        else if (h.includes('motorista')) idx.driver = i;
        else if (h.includes('cidade') && h.includes('atual')) idx.city = i;
        else if (h.includes('previsao') && h.includes('cheg')) idx.forecast = i;
        else if (h.includes('cidades') && h.includes('restante')) idx.remaining = i;
        else if (h.includes('observ')) idx.obs = i;
      });
      continue;
    }
    if (!Object.keys(idx).length) continue;
    const date = idx.date != null ? excelSerialToIso(row[idx.date]) : null;
    const driver = idx.driver != null ? cellStr(row[idx.driver]) : null;
    if (!date && !driver) continue;
    const remainingText = idx.remaining != null ? cellStr(row[idx.remaining]) : null;
    forecasts.push({
      forecast_date: date,
      forecast_time: idx.time != null ? excelSerialToTime(row[idx.time]) : null,
      weekday: idx.weekday != null ? cellStr(row[idx.weekday]) : null,
      driver_name: driver,
      current_city: idx.city != null ? cellStr(row[idx.city]) : null,
      forecast_text: idx.forecast != null ? cellStr(row[idx.forecast]) : null,
      remaining_cities_text: remainingText,
      remaining_cities: parseRemainingCities(remainingText),
      observation: idx.obs != null ? cellStr(row[idx.obs]) : null,
    });
    if (!date && idx.date != null && row[idx.date] != null && row[idx.date] !== '') {
      errors.push(`Data inválida na aba Chegada: ${row[idx.date]}`);
    }
  }
  return forecasts;
}

export function parseDriverMonitoringWorkbook(buffer: ArrayBuffer): ParsedDriverMonitoringWorkbook {
  const errors: string[] = [];
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const entregas = findSheet(wb, 'entregas');
  const chegada = findSheet(wb, 'chegada');
  const monitors = entregas ? parseEntregasSheet(entregas, errors) : [];
  const forecasts = chegada ? parseChegadaSheet(chegada, errors) : [];
  return { monitors, forecasts, errors, sheetNames: wb.SheetNames };
}

// Normalize spreadsheet status text -> canonical.
export function normalizeSpreadsheetStatus(v: string | null | undefined) {
  return normalizeStatusLabel(v);
}

// Expose helpers for external re-use / tests
export { excelSerialToTime };