/**
 * Formatação segura de datas para relatórios.
 *
 * Motivo: `new Date('YYYY-MM-DD')` é interpretado como UTC 00:00.
 * Em fusos negativos (Brasil UTC-3) isso mostra o dia anterior.
 * Estas funções tratam DATE puro localmente e mantêm timestamps ISO como antes.
 */

function isDateOnly(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export const APP_TIME_ZONE = 'America/Sao_Paulo';

function zonedParts(value: Date, includeTime = false, timeZone = APP_TIME_ZONE): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : {}),
  });
  return Object.fromEntries(
    formatter.formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
}

function zonedMidnightUtc(year: number, month: number, day: number, timeZone = APP_TIME_ZONE): Date {
  const wanted = Date.UTC(year, month - 1, day);
  let instant = wanted;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(instant), true, timeZone);
    const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    instant += wanted - observed;
  }
  return new Date(instant);
}

/** Limites UTC [início, fim) do dia civil de São Paulo, inclusive em mudanças de fuso. */
export function localDateUtcRange(dateOnly: string): { from: string; toExclusive: string } {
  return dateOnlyUtcRange(dateOnly, APP_TIME_ZONE);
}

/** Limites UTC [início, fim) de um dia civil no fuso informado. */
export function dateOnlyUtcRange(dateOnly: string, timeZone = APP_TIME_ZONE): { from: string; toExclusive: string } {
  if (!isDateOnly(dateOnly)) throw new Error('Data local inválida');
  const [year, month, day] = dateOnly.split('-').map(Number);
  const current = new Date(Date.UTC(year, month - 1, day));
  if (current.getUTCFullYear() !== year || current.getUTCMonth() !== month - 1 || current.getUTCDate() !== day) {
    throw new Error('Data local inválida');
  }
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    from: zonedMidnightUtc(year, month, day, timeZone).toISOString(),
    toExclusive: zonedMidnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone).toISOString(),
  };
}

/** Retorna null enquanto um seletor de data estiver vazio ou incompleto. */
export function optionalLocalDateUtcRange(dateOnly: string, timeZone = APP_TIME_ZONE): { from: string; toExclusive: string } | null {
  if (!dateOnly) return null;
  try { return dateOnlyUtcRange(dateOnly, timeZone); }
  catch { return null; }
}

/** Valor de input date para o calendário operacional de São Paulo. */
export function localDateInputValue(value: Date = new Date(), timeZone = APP_TIME_ZONE): string {
  const { year, month, day } = zonedParts(value, false, timeZone);
  return `${year}-${month}-${day}`;
}

/** Data civil exibida por um seletor de calendário no dispositivo. */
export function datePickerInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Constrói um valor de calendário local a partir de AAAA-MM-DD. */
export function dateInputPickerValue(value: string): Date {
  dateOnlyUtcRange(value, 'UTC');
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

/** Desloca uma data civil sem consultar o fuso do dispositivo. */
export function shiftDateInputValue(value: string, days: number): string {
  if (!Number.isInteger(days)) throw new Error('Deslocamento de data inválido');
  const range = dateOnlyUtcRange(value, 'UTC');
  return new Date(Date.parse(range.from) + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Intervalo inclusivo das últimas N datas civis no fuso informado. */
export function trailingCivilDateRange(
  days: number,
  timeZone = APP_TIME_ZONE,
  value: Date = new Date(),
): { start: string; end: string } {
  if (!Number.isInteger(days) || days < 1) throw new Error('Quantidade de dias inválida');
  const end = localDateInputValue(value, timeZone);
  return { start: shiftDateInputValue(end, -(days - 1)), end };
}

/** Valor de input datetime-local sem converter o relógio local para UTC. */
export function localDateTimeInputValue(value: Date | string = new Date(), timeZone = APP_TIME_ZONE): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const { year, month, day, hour, minute } = zonedParts(date, true, timeZone);
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/** Interpreta o relógio de um datetime-local no fuso operacional de São Paulo. */
export function localDateTimeInputToIso(value: string, timeZone = APP_TIME_ZONE): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('Data e hora local inválida');
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const [year, month, day, hour, minute] = [yearText, monthText, dayText, hourText, minuteText].map(Number);
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  const normalized = new Date(wanted);
  if (normalized.getUTCFullYear() !== year || normalized.getUTCMonth() !== month - 1
    || normalized.getUTCDate() !== day || normalized.getUTCHours() !== hour
    || normalized.getUTCMinutes() !== minute) throw new Error('Data e hora local inválida');

  let instant = wanted;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(instant), true, timeZone);
    const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    const adjustment = wanted - observed;
    instant += adjustment;
    if (adjustment === 0) break;
  }
  if (localDateTimeInputValue(new Date(instant), timeZone) !== value) throw new Error('Data e hora local inválida');
  return new Date(instant).toISOString();
}

/** Formata um valor como data (dd/MM/yyyy) em pt-BR sem sofrer com fuso. */
export function fmtDateSafe(v: unknown, fallback = '—'): string {
  if (v == null || v === '') return fallback;
  const s = String(v).trim();
  if (isDateOnly(s)) {
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    if (!isNaN(dt.getTime())) return dt.toLocaleDateString('pt-BR');
    return s;
  }
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('pt-BR');
}

/** Formata como data e hora em pt-BR; para DATE puro devolve só a data. */
export function fmtDateTimeSafe(v: unknown, fallback = '—'): string {
  if (v == null || v === '') return fallback;
  const s = String(v).trim();
  if (isDateOnly(s)) return fmtDateSafe(s, fallback);
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('pt-BR');
}

/** Formata uma data no calendário operacional informado, sem depender do fuso do navegador. */
export function fmtDateInTimeZone(v: unknown, timeZone = APP_TIME_ZONE, fallback = '—'): string {
  if (v == null || v === '') return fallback;
  const value = String(v).trim();
  if (isDateOnly(value)) return fmtDateSafe(value, fallback);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone, day: '2-digit', month: '2-digit', year: 'numeric',
    }).format(date);
  } catch {
    return fallback;
  }
}

/** Formata um instante no calendário operacional informado, sem depender do fuso do navegador. */
export function fmtDateTimeInTimeZone(v: unknown, timeZone = APP_TIME_ZONE, fallback = '—'): string {
  if (v == null || v === '') return fallback;
  const date = new Date(String(v));
  if (Number.isNaN(date.getTime())) return String(v);
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone, day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(date).replace(',', '');
  } catch {
    return fallback;
  }
}
